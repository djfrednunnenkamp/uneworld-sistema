"""Serviço de envio de e-mail via Resend."""
import html
import logging
import re

import resend
from django.conf import settings

from agenda._logo import LOGO_CID, LOGO_B64_CONTENT, get_logo_src
from core.logutils import mask_email

logger = logging.getLogger(__name__)


def _html_for_preview(html: str) -> str:
    return html.replace(
        f'cid:{LOGO_CID}',
        f'data:image/png;base64,{LOGO_B64_CONTENT}',
    )


def _redact_sensitive(html: str) -> str:
    """Redige tokens de ação (reset de senha / convite) no corpo GUARDADO no log.

    SEGURANÇA (A-01): o preview do Log de E-mails é liberado por email_log_preview,
    uma permissão concedível a NÃO-super. Guardar o link com o token vivo permitiria
    a esse usuário abrir o reset de senha de QUALQUER conta (inclusive superusuário)
    e assumi-la — takeover. Só a cópia do log é redigida; o e-mail enviado ao
    destinatário mantém o token real."""
    return re.sub(r'(?i)(token=)[^"\'&\s<>]+', r'\1[REDIGIDO]', html)


def _send(to: str, subject: str, html: str, email_type: str = 'other') -> bool:
    """Envia por Resend (padrão). Sem RESEND_API_KEY mas com EMAIL_HOST, cai no SMTP
    do Django (ex.: Mailgun). Sem nenhum dos dois, apenas simula/loga."""
    from agenda.models import EmailLog
    html_preview = _redact_sensitive(_html_for_preview(html))
    masked = mask_email(to)

    resend_key = settings.RESEND_API_KEY
    resend_ok  = bool(resend_key) and not resend_key.startswith('re_sua_chave')
    smtp_ok    = bool(getattr(settings, 'EMAIL_HOST', ''))

    if resend_ok:
        return _send_via_resend(to, subject, html, html_preview, email_type, masked)
    if smtp_ok:
        return _send_via_smtp(to, subject, html, html_preview, email_type, masked)

    logger.debug("E-mail simulado (sem Resend/SMTP): %s → %s", subject, masked)
    EmailLog.objects.create(to=to, subject=subject, email_type=email_type, html_body=html_preview, success=True)
    return True


def _send_via_resend(to, subject, html, html_preview, email_type, masked):
    from agenda.models import EmailLog
    resend.api_key = settings.RESEND_API_KEY
    _, use_cid = get_logo_src()
    payload = {
        "from": settings.RESEND_FROM,
        "to": [to],
        "subject": subject,
        "html": html,
    }
    if use_cid:
        payload["attachments"] = [{
            "filename": "logo.png",
            "content": LOGO_B64_CONTENT,
            "content_id": LOGO_CID,
        }]
    try:
        response = resend.Emails.send(payload)
        EmailLog.objects.create(to=to, subject=subject, email_type=email_type, html_body=html_preview,
                                success=True, resend_id=response.get('id'), status='sent')
        return True
    except Exception as e:
        logger.error("Falha ao enviar e-mail via Resend (%s): %s", masked, e)
        EmailLog.objects.create(to=to, subject=subject, email_type=email_type, html_body=html_preview,
                                success=False, status='failed')
        return False


def _send_via_smtp(to, subject, html, html_preview, email_type, masked):
    """Fallback SMTP (Django). Sem rastreamento por webhook (EmailLog sem resend_id).
    Se o logo usa CID, anexa a imagem inline (multipart/related)."""
    import base64
    from email.mime.image import MIMEImage
    from django.core.mail import EmailMultiAlternatives
    from agenda.models import EmailLog

    _, use_cid = get_logo_src()
    from_addr = getattr(settings, 'EMAIL_FROM', '') or settings.EMAIL_HOST_USER
    try:
        msg = EmailMultiAlternatives(
            subject=subject,
            body='Este e-mail requer um cliente com suporte a HTML.',
            from_email=from_addr,
            to=[to],
        )
        msg.attach_alternative(html, 'text/html')
        if use_cid:
            msg.mixed_subtype = 'related'
            img = MIMEImage(base64.b64decode(LOGO_B64_CONTENT))
            img.add_header('Content-ID', f'<{LOGO_CID}>')
            img.add_header('Content-Disposition', 'inline', filename='logo.png')
            msg.attach(img)
        msg.send(fail_silently=False)
        EmailLog.objects.create(to=to, subject=subject, email_type=email_type, html_body=html_preview,
                                success=True, status='sent')
        return True
    except Exception as e:
        logger.error("Falha ao enviar e-mail via SMTP (%s): %s", masked, e)
        EmailLog.objects.create(to=to, subject=subject, email_type=email_type, html_body=html_preview,
                                success=False, status='failed')
        return False


def _wrap(body_rows: str, accent: str = '#2e6db4') -> str:
    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7">
    <tr><td style="padding:28px">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06),0 8px 32px rgba(0,0,0,.06)">
        <!-- Logo -->
        <tr>
          <td style="background:#ffffff;padding:24px 32px 20px;text-align:center;border-bottom:3px solid #1a2d4f">
            <img src="{get_logo_src()[0]}" alt="UneWorld Turismo" width="160" height="104"
                 style="display:block;margin:0 auto;max-width:160px;height:auto;border:0" />
          </td>
        </tr>
        <!-- Accent -->
        <tr><td style="background:{accent};height:4px;font-size:0;line-height:0">&nbsp;</td></tr>
        <!-- Body -->
        {body_rows}
        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 32px;text-align:center">
            <p style="margin:0;font-size:11px;color:#94a3b8;letter-spacing:.02em">
              UneWorld Turismo &nbsp;&middot;&nbsp; Sistema de Gestão
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def send_reset_password(email: str, first_name: str, reset_url: str) -> bool:
    """Envia e-mail de redefinição de senha."""
    first_name = html.escape(first_name or '')
    body = f"""
      <tr>
        <td style="padding:32px 32px 12px">
          <p style="margin:0 0 6px;font-size:17px;font-weight:700;color:#0f172a">
            Olá{f', {first_name}' if first_name else ''}!
          </p>
          <p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.65">
            Recebemos uma solicitação para redefinir a senha da sua conta UneWorld.<br>
            Clique no botão abaixo para criar uma nova senha.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px">
            <tr>
              <td style="border-radius:10px;background:#2e6db4;text-align:center">
                <a href="{reset_url}"
                   style="display:inline-block;padding:14px 36px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:.02em">
                  Redefinir minha senha
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 32px 28px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px">
            <tr>
              <td style="font-size:12px;color:#64748b;line-height:1.6">
                <strong style="color:#0f172a">&#128274; Por segurança:</strong><br>
                O link expira em <strong>2 horas</strong>.
                Se você não solicitou esta redefinição, ignore este e-mail.
                Nunca compartilhe este link com ninguém.
              </td>
            </tr>
          </table>
        </td>
      </tr>"""
    return _send(email, 'Redefinição de senha — UneWorld Turismo', _wrap(body, '#2e6db4'), 'reset_password')


def send_invite(email: str, first_name: str, invite_url: str, invited_by: str) -> bool:
    """Envia convite para novo usuário criar sua conta."""
    first_name = html.escape(first_name or '')
    invited_by = html.escape(invited_by or '')
    body = f"""
      <tr>
        <td style="padding:32px 32px 12px">
          <p style="margin:0 0 6px;font-size:17px;font-weight:700;color:#0f172a">
            Olá{f', {first_name}' if first_name else ''}!
          </p>
          <p style="margin:0 0 8px;font-size:14px;color:#64748b;line-height:1.65">
            <strong style="color:#0f172a">{invited_by}</strong> convidou você para acessar
            o sistema de gestão da <strong style="color:#0f172a">UneWorld Turismo</strong>.
          </p>
          <p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.65">
            Clique no botão abaixo para criar sua senha e ativar sua conta.
            O convite expira em <strong style="color:#0f172a">7 dias</strong>.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px">
            <tr>
              <td style="border-radius:10px;background:#059669;text-align:center">
                <a href="{invite_url}"
                   style="display:inline-block;padding:14px 36px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:.02em">
                  Criar minha conta
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 32px 28px">
          <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center">
            Se você não esperava este convite, pode ignorar este e-mail com segurança.
          </p>
        </td>
      </tr>"""
    return _send(email, 'Convite — UneWorld Turismo', _wrap(body, '#059669'), 'invite')
