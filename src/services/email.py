import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import os

def send_email(to_email, subject, body):
    """Send an email using SMTP settings from environment variables."""
    sender_email = os.getenv("SMTP_USER")
    sender_password = os.getenv("SMTP_PASSWORD")
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = os.getenv("SMTP_PORT")

    if not all([sender_email, sender_password, smtp_host, smtp_port]):
        raise ValueError("Missing required SMTP configuration")

    msg = MIMEMultipart()
    msg["From"] = str(sender_email)
    msg["To"] = str(to_email)
    msg["Subject"] = subject

    msg.attach(MIMEText(body, "plain"))

    with smtplib.SMTP(smtp_host, int(smtp_port)) as server:
        server.starttls()
        server.login(str(sender_email), str(sender_password))
        server.send_message(msg)
