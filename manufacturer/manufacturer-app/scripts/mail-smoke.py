#!/usr/bin/env python3
"""Local SMTP/IMAP smoke harness for the Manufacturer supplier-mail demo."""

from __future__ import annotations

import argparse
import imaplib
import os
import smtplib
import sys
import time
from dataclasses import dataclass
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import formatdate, make_msgid
from pathlib import Path
from ssl import create_default_context


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TIMEOUT = 20


@dataclass(frozen=True)
class Mailbox:
    name: str
    address: str
    password: str
    imap_host: str
    imap_port: int
    smtp_host: str
    smtp_port: int


def load_dotenv() -> None:
    env_path = ROOT / '.env'
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


def required(name: str) -> str:
    value = os.environ.get(name, '').strip()
    if not value:
        raise RuntimeError(f'Missing required environment variable: {name}')
    return value


def integer_env(*names: str, default: int) -> int:
    for name in names:
        value = os.environ.get(name, '').strip()
        if value:
            return int(value)
    return default


def mailbox_for(name: str) -> Mailbox:
    normalized = name.lower()
    if normalized == 'supplier1':
        address = required('OM_TEST_SUPPLIER1_EMAIL')
        password = required('OM_TEST_SUPPLIER1_PASSWORD')
    elif normalized == 'supplier2':
        address = required('OM_TEST_SUPPLIER2_EMAIL')
        password = required('OM_TEST_SUPPLIER2_PASSWORD')
    elif normalized == 'manufacturer':
        address = os.environ.get('OM_TEST_MANUFACTURER_EMAIL', '').strip() or required('OM_SEED_IMAP_ADDRESS')
        password = required('OM_SEED_IMAP_PASSWORD')
    else:
        raise RuntimeError(f'Unsupported mailbox: {name}')
    return Mailbox(
        name=normalized,
        address=address,
        password=password,
        imap_host=os.environ.get('OM_TEST_IMAP_HOST', '').strip() or required('OM_SEED_IMAP_HOST'),
        imap_port=integer_env('OM_TEST_IMAP_PORT', 'OM_SEED_IMAP_PORT', default=993),
        smtp_host=os.environ.get('OM_TEST_SMTP_HOST', '').strip() or required('OM_SEED_SMTP_HOST'),
        smtp_port=integer_env('OM_TEST_SMTP_PORT', 'OM_SEED_SMTP_PORT', default=587),
    )


def smtp_send(sender: Mailbox, message: EmailMessage) -> None:
    context = create_default_context()
    if sender.smtp_port == 465:
        with smtplib.SMTP_SSL(sender.smtp_host, sender.smtp_port, timeout=DEFAULT_TIMEOUT, context=context) as client:
            client.login(sender.address, sender.password)
            client.send_message(message)
        return
    with smtplib.SMTP(sender.smtp_host, sender.smtp_port, timeout=DEFAULT_TIMEOUT) as client:
        client.ehlo()
        client.starttls(context=context)
        client.ehlo()
        client.login(sender.address, sender.password)
        client.send_message(message)


def open_inbox(mailbox: Mailbox) -> imaplib.IMAP4_SSL:
    client = imaplib.IMAP4_SSL(mailbox.imap_host, mailbox.imap_port, timeout=DEFAULT_TIMEOUT)
    client.login(mailbox.address, mailbox.password)
    status, _ = client.select('INBOX', readonly=True)
    if status != 'OK':
        client.logout()
        raise RuntimeError(f'Could not select INBOX for {mailbox.name}')
    return client


def search_uids(mailbox: Mailbox, sender: str | None, subject: str | None, unread_only: bool) -> list[bytes]:
    client = open_inbox(mailbox)
    try:
        criteria = ['UNSEEN' if unread_only else 'ALL']
        if sender:
            criteria.append(f'FROM {imap_search_value(sender)}')
        if subject:
            criteria.append(f'SUBJECT {imap_search_value(subject)}')
        status, data = client.uid('SEARCH', None, *criteria)
        if status != 'OK':
            raise RuntimeError(f'IMAP search failed for {mailbox.name}')
        return data[0].split() if data and data[0] else []
    finally:
        try:
            client.close()
        finally:
            client.logout()


def imap_search_value(value: str) -> str:
    escaped = value.replace('\\', '\\\\').replace('"', '\\"')
    return f'"{escaped}"'


def fetch_header(mailbox: Mailbox, uid: bytes) -> dict[str, str]:
    client = open_inbox(mailbox)
    try:
        status, data = client.uid('FETCH', uid, '(BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)])')
        if status != 'OK':
            raise RuntimeError(f'IMAP fetch failed for {mailbox.name}')
        raw_header = next((part[1] for part in data if isinstance(part, tuple)), b'')
        message = BytesParser(policy=policy.default).parsebytes(raw_header)
        return {
            'uid': uid.decode('ascii'),
            'from': message.get('From', ''),
            'to': message.get('To', ''),
            'subject': message.get('Subject', ''),
            'date': message.get('Date', ''),
            'message_id': message.get('Message-ID', ''),
            'in_reply_to': message.get('In-Reply-To', ''),
            'references': message.get('References', ''),
        }
    finally:
        try:
            client.close()
        finally:
            client.logout()


def matching_messages(mailbox: Mailbox, sender: str | None, subject: str | None, unread_only: bool) -> list[dict[str, str]]:
    messages = [fetch_header(mailbox, uid) for uid in search_uids(mailbox, sender, subject, unread_only)]
    return list(reversed(messages))


def print_message(message: dict[str, str]) -> None:
    print(' '.join(f'{key}={value}' for key, value in message.items() if value))


def command_check_config(_: argparse.Namespace) -> int:
    for name in ('manufacturer', 'supplier1', 'supplier2'):
        mailbox = mailbox_for(name)
        print(f'{name}: address={mailbox.address} imap={mailbox.imap_host}:{mailbox.imap_port} smtp={mailbox.smtp_host}:{mailbox.smtp_port}')
    return 0


def command_send_inbound(args: argparse.Namespace) -> int:
    sender = mailbox_for(args.supplier)
    recipient = args.to or mailbox_for('manufacturer').address
    message_id = args.message_id or make_msgid(domain=sender.address.rsplit('@', 1)[-1])
    message = EmailMessage()
    message['From'] = sender.address
    message['To'] = recipient
    message['Subject'] = args.subject
    message['Date'] = formatdate(localtime=True)
    message['Message-ID'] = message_id
    if args.in_reply_to:
        message['In-Reply-To'] = args.in_reply_to
    if args.references:
        message['References'] = args.references
    message.set_content(args.body)
    smtp_send(sender, message)
    print(f'sent supplier={sender.name} to={recipient} message_id={message_id}')
    return 0


def command_list_mail(args: argparse.Namespace) -> int:
    mailbox = mailbox_for(args.mailbox)
    messages = matching_messages(mailbox, args.sender, args.subject, args.unread_only)
    for message in messages[:args.limit]:
        print_message(message)
    print(f'found={min(len(messages), args.limit)} mailbox={mailbox.name}')
    return 0


def command_wait_for_mail(args: argparse.Namespace) -> int:
    mailbox = mailbox_for(args.mailbox)
    deadline = time.monotonic() + args.timeout
    while True:
        messages = matching_messages(mailbox, args.sender, args.subject, args.unread_only)
        if messages:
            print_message(messages[0])
            return 0
        if time.monotonic() >= deadline:
            print(f'timeout mailbox={mailbox.name}', file=sys.stderr)
            return 1
        time.sleep(min(args.poll_seconds, max(0.1, deadline - time.monotonic())))


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description='Safe local SMTP/IMAP smoke harness for supply_cases.')
    subparsers = root.add_subparsers(dest='command', required=True)

    check = subparsers.add_parser('check-config', help='validate configured mailbox variables without network access')
    check.set_defaults(handler=command_check_config)

    send = subparsers.add_parser('send-inbound', help='send one inbound message from Supplier 1 or Supplier 2')
    send.add_argument('--supplier', choices=('supplier1', 'supplier2'), required=True)
    send.add_argument('--subject', required=True)
    send.add_argument('--body', required=True)
    send.add_argument('--to')
    send.add_argument('--message-id')
    send.add_argument('--in-reply-to')
    send.add_argument('--references')
    send.set_defaults(handler=command_send_inbound)

    for command_name, handler in (('list-mail', command_list_mail), ('wait-for-mail', command_wait_for_mail)):
        command = subparsers.add_parser(command_name, help='inspect one configured mailbox')
        command.add_argument('--mailbox', choices=('manufacturer', 'supplier1', 'supplier2'), required=True)
        command.add_argument('--sender')
        command.add_argument('--subject')
        command.add_argument('--unread-only', action='store_true')
        if command_name == 'list-mail':
            command.add_argument('--limit', type=int, default=10)
        else:
            command.add_argument('--timeout', type=int, default=120)
            command.add_argument('--poll-seconds', type=float, default=5)
        command.set_defaults(handler=handler)
    return root


def main() -> int:
    load_dotenv()
    arguments = parser().parse_args()
    try:
        return arguments.handler(arguments)
    except (OSError, ValueError, RuntimeError, imaplib.IMAP4.error, smtplib.SMTPException) as error:
        print(f'error={type(error).__name__}: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
