"""
Serviço de envio de e-mail via Resend.
"""
import resend
from django.conf import settings


def _configure():
    resend.api_key = settings.RESEND_API_KEY


def send_reset_password(email: str, first_name: str, reset_url: str) -> bool:
    """Envia e-mail de redefinição de senha."""
    _configure()
    if not settings.RESEND_API_KEY or settings.RESEND_API_KEY.startswith('re_sua_chave'):
        print(f"[EMAIL SIMULADO] Reset de senha para {email}: {reset_url}")
        return True
    try:
        resend.Emails.send({
            "from":    settings.RESEND_FROM,
            "to":      [email],
            "subject": "Redefinição de senha — UneWorld Turismo",
            "html": f"""
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f2f8;margin:0;padding:32px 16px">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
    <div style="background:#1a2d4f;padding:24px 32px;text-align:center">
      <p style="color:#fff;font-size:22px;font-weight:700;margin:0">Une<span style="color:#6BA3C8">World</span></p>
      <p style="color:rgba(255,255,255,.5);font-size:12px;margin:4px 0 0;letter-spacing:.1em;text-transform:uppercase">Turismo</p>
    </div>
    <div style="padding:32px">
      <p style="color:#1e293b;font-size:16px;font-weight:600;margin:0 0 12px">Olá{f', {first_name}' if first_name else ''}!</p>
      <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0 0 24px">
        Recebemos uma solicitação para redefinir a senha da sua conta UneWorld.<br>
        Clique no botão abaixo para criar uma nova senha. O link expira em <strong>2 horas</strong>.
      </p>
      <div style="text-align:center;margin:0 0 24px">
        <a href="{reset_url}" style="display:inline-block;background:#2e6db4;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:14px">
          Redefinir minha senha
        </a>
      </div>
      <p style="color:#94a3b8;font-size:12px;line-height:1.5;margin:0">
        Se você não solicitou a redefinição de senha, ignore este e-mail.<br>
        Por segurança, nunca compartilhe este link.
      </p>
    </div>
    <div style="background:#f8fafc;padding:16px 32px;text-align:center;border-top:1px solid #e2e8f0">
      <p style="color:#94a3b8;font-size:12px;margin:0">UneWorld Turismo · Sistema de Gestão</p>
    </div>
  </div>
</body>
</html>""",
        })
        return True
    except Exception as e:
        print(f"[RESEND ERROR] {e}")
        return False


def send_invite(email: str, first_name: str, invite_url: str, invited_by: str) -> bool:
    """Envia convite para novo usuário criar sua conta."""
    _configure()
    if not settings.RESEND_API_KEY or settings.RESEND_API_KEY.startswith('re_sua_chave'):
        print(f"[EMAIL SIMULADO] Convite para {email}: {invite_url}")
        return True
    try:
        resend.Emails.send({
            "from":    settings.RESEND_FROM,
            "to":      [email],
            "subject": "Convite para o sistema UneWorld Turismo",
            "html": f"""
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f2f8;margin:0;padding:32px 16px">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
    <div style="background:#1a2d4f;padding:24px 32px;text-align:center">
      <p style="color:#fff;font-size:22px;font-weight:700;margin:0">Une<span style="color:#6BA3C8">World</span></p>
      <p style="color:rgba(255,255,255,.5);font-size:12px;margin:4px 0 0;letter-spacing:.1em;text-transform:uppercase">Turismo</p>
    </div>
    <div style="padding:32px">
      <p style="color:#1e293b;font-size:16px;font-weight:600;margin:0 0 12px">Olá{f', {first_name}' if first_name else ''}!</p>
      <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0 0 8px">
        <strong>{invited_by}</strong> convidou você para acessar o sistema de gestão da UneWorld Turismo.
      </p>
      <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0 0 24px">
        Clique no botão abaixo para criar sua senha e ativar sua conta. O convite expira em <strong>7 dias</strong>.
      </p>
      <div style="text-align:center;margin:0 0 24px">
        <a href="{invite_url}" style="display:inline-block;background:#2e6db4;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:14px">
          Criar minha conta
        </a>
      </div>
      <p style="color:#94a3b8;font-size:12px;line-height:1.5;margin:0">
        Se você não esperava este convite, ignore este e-mail.
      </p>
    </div>
    <div style="background:#f8fafc;padding:16px 32px;text-align:center;border-top:1px solid #e2e8f0">
      <p style="color:#94a3b8;font-size:12px;margin:0">UneWorld Turismo · Sistema de Gestão</p>
    </div>
  </div>
</body>
</html>""",
        })
        return True
    except Exception as e:
        print(f"[RESEND ERROR] {e}")
        return False
