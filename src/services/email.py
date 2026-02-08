import os
import resend


def send_password_reset_email(to_email, reset_token):
    api_key = os.getenv("RESEND_API_KEY")
    if not api_key:
        print("WARNING: RESEND_API_KEY not set, cannot send email")
        return False

    resend.api_key = api_key
    base_url = os.getenv("BASE_URL", "http://localhost:5000")
    reset_link = f"{base_url}/login#reset={reset_token}"

    try:
        resend.Emails.send({
            "from": "MelodAI <noreply@logge.top>",
            "to": [to_email],
            "subject": "MelodAI - Password Reset",
            "html": f"""
            <div style="font-family: 'Poppins', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
                <h1 style="color: #d90429; font-family: 'Barlow Condensed', sans-serif; text-transform: uppercase;">MelodAI</h1>
                <p>You requested a password reset. Click the link below to set a new password:</p>
                <a href="{reset_link}" style="display: inline-block; padding: 12px 32px; background: linear-gradient(135deg, #d90429, #8b0000); color: white; text-decoration: none; border-radius: 50px; font-weight: 600;">Reset Password</a>
                <p style="margin-top: 24px; color: #666; font-size: 13px;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
            </div>
            """,
        })
        return True
    except Exception as e:
        print(f"ERROR sending email: {e}")
        return False
