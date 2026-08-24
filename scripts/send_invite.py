"""
Sends a transactional email to a CPO Check user (welcome, role change, or
revoked notice) via Gmail SMTP. Triggered by a GitHub Actions
repository_dispatch event fired from index.html's static-mode addUser /
revokeUser / reinstateUser functions.

Required GitHub Secrets:
  SMTP_USERNAME  — full Gmail address to send from
  SMTP_PASSWORD  — 16-character Gmail App Password (not the regular password)

Required env vars (passed by the workflow from client_payload):
  TO_EMAIL     — recipient address
  ROLE         — role string, or blank for 'revoked' kind
  SUPERVISOR   — supervisor area name, optional
  EMAIL_KIND   — one of: welcome | revoked | reinstated
"""
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

SMTP_USERNAME = os.environ.get("SMTP_USERNAME", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
TO_EMAIL = os.environ.get("TO_EMAIL", "").strip()
ROLE = os.environ.get("ROLE", "").strip()
SUPERVISOR = os.environ.get("SUPERVISOR", "").strip()
EMAIL_KIND = os.environ.get("EMAIL_KIND", "welcome").strip() or "welcome"

APP_URL = "https://snoop214.github.io/CPO-Check/"
BRAND_DARK = "#411517"
BRAND_ORANGE = "#FF5A00"

SUBJECTS = {
    "welcome": "Access granted — talabat LS CPO Check",
    "revoked": "CPO Check access revoked",
    "reinstated": "CPO Check access reinstated",
}
TITLES = {
    "welcome": "Access Granted",
    "revoked": "Access Revoked",
    "reinstated": "Access Reinstated",
}


def build_body_lines():
    sup_line = f"<br>Supervisor area: {SUPERVISOR}" if SUPERVISOR else ""
    if EMAIL_KIND == "welcome":
        return [
            f"You have access to CPO Check as <strong>{ROLE}</strong>.{sup_line}",
            "Click below to open the dashboard.",
        ]
    if EMAIL_KIND == "revoked":
        return ["Your access has been revoked. Contact your admin if this is unexpected."]
    if EMAIL_KIND == "reinstated":
        return [f"Your access has been reinstated as <strong>{ROLE}</strong>.{sup_line}"]
    return ["Your CPO Check access has changed."]


def build_html():
    title = TITLES.get(EMAIL_KIND, "CPO Check")
    body_lines = build_body_lines()
    show_cta = EMAIL_KIND != "revoked"

    body_html = "".join(
        f'<p style="font-size:13px;color:#555;margin:0 0 10px;line-height:1.6;">{line}</p>'
        for line in body_lines
    )
    cta_html = ""
    if show_cta:
        cta_html = (
            '<div style="text-align:center;margin:24px 0;">'
            f'<a href="{APP_URL}" style="display:inline-block;padding:12px 32px;'
            f'background:{BRAND_ORANGE};color:#fff;text-decoration:none;border-radius:8px;'
            'font-weight:600;">Open Dashboard</a></div>'
        )

    return f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;
                border-radius:12px;border:1px solid #e5e0db;">
      <div style="background:{BRAND_DARK};color:#fff;padding:24px 32px;">
        <h1 style="margin:0;font-size:20px;">talabat <span style="color:{BRAND_ORANGE};">LS</span>
        — CPO Check</h1>
        <p style="margin:6px 0 0;font-size:13px;opacity:.8;">{title}</p>
      </div>
      <div style="padding:28px 32px;">
        <p style="font-size:14px;color:{BRAND_DARK};margin:0 0 16px;">Hello,</p>
        {body_html}
        {cta_html}
        <hr style="border:none;border-top:1px solid #e5e0db;margin:24px 0;">
        <p style="font-size:11px;color:#999;margin:0;">Automated from talabat LS CPO Check.</p>
      </div>
    </div>
    """


def main():
    if not SMTP_USERNAME or not SMTP_PASSWORD:
        raise SystemExit("Missing SMTP_USERNAME or SMTP_PASSWORD secret.")
    if not TO_EMAIL or "@" not in TO_EMAIL:
        raise SystemExit(f"Invalid or missing TO_EMAIL: '{TO_EMAIL}'")

    subject = SUBJECTS.get(EMAIL_KIND, "CPO Check notification")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"talabat LS CPO Check <{SMTP_USERNAME}>"
    msg["To"] = TO_EMAIL
    msg.attach(MIMEText(build_html(), "html"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(SMTP_USERNAME, SMTP_PASSWORD)
        server.sendmail(SMTP_USERNAME, [TO_EMAIL], msg.as_string())

    print(f"Sent '{EMAIL_KIND}' email to {TO_EMAIL}")


if __name__ == "__main__":
    main()
