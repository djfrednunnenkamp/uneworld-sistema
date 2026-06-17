"""Envio de e-mails transacionais do calendário via Resend."""
import resend
from django.conf import settings


# ── Helpers de template ───────────────────────────────────────────────────────

def _header() -> str:
    return """
      <tr>
        <td style="background:#1a2d4f;padding:22px 32px;text-align:center">
          <p style="margin:0;font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-.4px;font-family:Georgia,serif">
            Une<span style="color:#6ba3c8">World</span>
          </p>
          <p style="margin:4px 0 0;font-size:9px;font-weight:700;color:rgba(255,255,255,.38);letter-spacing:.25em;text-transform:uppercase">
            Turismo
          </p>
        </td>
      </tr>"""


def _accent(color: str) -> str:
    return f'<tr><td style="background:{color};height:4px;font-size:0;line-height:0">&nbsp;</td></tr>'


def _section_header(icon: str, title: str, subtitle: str, accent: str) -> str:
    return f"""
      <tr>
        <td style="padding:28px 32px 0">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:44px;height:44px;background:{accent}18;border-radius:12px;text-align:center;vertical-align:middle;font-size:22px">
                {icon}
              </td>
              <td style="padding-left:14px;vertical-align:middle">
                <p style="margin:0;font-size:20px;font-weight:700;color:#0f172a;line-height:1.2">{title}</p>
                <p style="margin:3px 0 0;font-size:13px;color:#64748b">{subtitle}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>"""


def _footer() -> str:
    return """
      <tr>
        <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 32px;text-align:center">
          <p style="margin:0;font-size:11px;color:#94a3b8;letter-spacing:.02em">
            UneWorld Turismo &nbsp;&middot;&nbsp; Sistema de Gestão
          </p>
        </td>
      </tr>"""


def _wrap(rows: str, accent: str = '#2e6db4') -> str:
    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;min-height:100vh">
    <tr><td style="padding:36px 16px">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06),0 8px 32px rgba(0,0,0,.06)">
        {_header()}
        {_accent(accent)}
        {rows}
        {_footer()}
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def _send(to, subject, html):
    resend.api_key = settings.RESEND_API_KEY
    if not settings.RESEND_API_KEY or settings.RESEND_API_KEY.startswith('re_sua_chave'):
        print(f"[EMAIL SIMULADO] {subject} → {to}")
        return True
    try:
        resend.Emails.send({"from": settings.RESEND_FROM, "to": to if isinstance(to, list) else [to], "subject": subject, "html": html})
        return True
    except Exception as e:
        print(f"[RESEND ERROR] {e}")
        return False


# ── Helpers de formatação ─────────────────────────────────────────────────────

def _fmt(iso_str) -> str:
    if not iso_str:
        return ''
    parts = str(iso_str).split('-')
    return f'{parts[2]}/{parts[1]}/{parts[0]}' if len(parts) == 3 else str(iso_str)


# ── Resumo do calendário ──────────────────────────────────────────────────────

_TYPE_CFG = {
    'trip':     ('✈',  'Viagens',               '#1d4ed8', '#dbeafe'),
    'deadline': ('⏰', 'Prazos de confirmação',  '#b45309', '#fef3c7'),
    'birthday': ('🎂', 'Aniversários',           '#7c3aed', '#ede9fe'),
}


def _event_row(ev) -> str:
    if ev['type'] == 'trip' and ev['start'] != ev['end']:
        period = f"{_fmt(ev['start'])} – {_fmt(ev['end'])}"
    else:
        period = _fmt(ev['start'])
    sub = f'<span style="color:#94a3b8;font-size:12px"> &middot; {ev["subtitle"]}</span>' if ev.get('subtitle') else ''
    return f"""
        <tr>
          <td style="padding:9px 0;border-bottom:1px solid #f1f5f9;color:#1e293b;font-size:13px">
            <span style="font-weight:600;color:#64748b;min-width:80px;display:inline-block">{period}</span>
            {ev['title']}{sub}
          </td>
        </tr>"""


def _calendar_sections(events) -> str:
    grouped = {}
    for ev in events:
        grouped.setdefault(ev['type'], []).append(ev)

    out = []
    for key in ('trip', 'deadline', 'birthday'):
        items = grouped.get(key)
        if not items:
            continue
        icon, label, color, bg = _TYPE_CFG[key]
        rows = ''.join(_event_row(e) for e in items)
        out.append(f"""
        <div style="margin:0 0 20px">
          <p style="display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:999px;background:{bg};color:{color};font-size:12px;font-weight:700;margin:0 0 10px;letter-spacing:.02em">
            {icon} {label}
          </p>
          <table role="presentation" style="width:100%;border-collapse:collapse">{rows}</table>
        </div>""")

    if not out:
        return '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:16px 0">Nenhum evento encontrado para o período.</p>'
    return ''.join(out)


def send_calendar_summary(email: str, first_name: str, events: list, subject: str, intro: str) -> bool:
    body = f"""
      <tr><td style="padding:28px 32px">
        <p style="margin:0 0 6px;font-size:17px;font-weight:700;color:#0f172a">
          Olá{f', {first_name}' if first_name else ''}!
        </p>
        <p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.65">{intro}</p>
        {_calendar_sections(events)}
      </td></tr>"""
    return _send(email, f'{subject} — UneWorld Turismo', _wrap(body, '#2e6db4'))


# ── Prazos de confirmação ─────────────────────────────────────────────────────

def send_deadline_reminder(emails: list, deadline_date, entries: list, days_ahead: int = 0) -> bool:
    if not emails:
        return False

    date_str = _fmt(deadline_date)
    if days_ahead == 0:
        subject  = f'Prazos que vencem hoje ({date_str})'
        title    = 'Prazos que vencem hoje'
        subtitle = f'Data limite: {date_str}'
        badge    = 'Vence hoje'
        badge_bg = '#fef3c7'
        badge_fg = '#b45309'
    else:
        subject  = f'Prazos que vencem em {days_ahead} dias ({date_str})'
        title    = f'Prazos em {days_ahead} dias'
        subtitle = f'Data limite: {date_str}'
        badge    = f'Em {days_ahead} dias'
        badge_bg = '#dbeafe'
        badge_fg = '#1d4ed8'

    cards = ''
    for e in entries:
        reason = f'<p style="margin:6px 0 0;font-size:12px;color:#64748b;font-style:italic">{e["pending_reason"]}</p>' if e.get('pending_reason') else ''
        cards += f"""
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
          <tr>
            <td style="padding:14px 16px">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:top">
                    <p style="margin:0;font-size:14px;font-weight:700;color:#0f172a">{e['passenger_name']}</p>
                    <p style="margin:3px 0 0;font-size:12px;color:#64748b">{e['list_name']}</p>
                    {reason}
                  </td>
                  <td style="vertical-align:top;text-align:right;padding-left:12px;white-space:nowrap">
                    <span style="display:inline-block;padding:4px 12px;border-radius:999px;background:{badge_bg};color:{badge_fg};font-size:11px;font-weight:700">{badge}</span>
                  </td>
                </tr>
              </table>
              <p style="margin:8px 0 0;font-size:11px;color:#94a3b8">Prazo definido por {e.get('created_by', '—')}</p>
            </td>
          </tr>
        </table>"""

    body = f"""
      {_section_header('⏰', title, subtitle, '#b45309')}
      <tr><td style="padding:20px 32px 28px">
        <p style="margin:0 0 18px;font-size:14px;color:#64748b;line-height:1.65">
          Os seguintes passageiros têm prazo de confirmação em <strong style="color:#0f172a">{date_str}</strong> e ainda não confirmaram.
        </p>
        {cards}
      </td></tr>"""

    return _send(emails, f'{subject} — UneWorld Turismo', _wrap(body, '#b45309'))


# ── Pendências / tarefas ──────────────────────────────────────────────────────

def send_task_reminder(emails: list, deadline_date, entries: list) -> bool:
    if not emails:
        return False

    date_str = deadline_date.strftime('%d/%m/%Y') if hasattr(deadline_date, 'strftime') else str(deadline_date)
    subject  = f'Pendências que vencem hoje ({date_str})'

    cards = ''
    for e in entries:
        cards += f"""
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;border:1px solid #e2e8f0;border-left:4px solid #059669;border-radius:10px;overflow:hidden">
          <tr>
            <td style="padding:14px 16px">
              <p style="margin:0;font-size:14px;font-weight:700;color:#0f172a">{e['title']}</p>
              <p style="margin:4px 0 0;font-size:12px;color:#64748b">
                Lista: <strong>{e['list_name']}</strong> &nbsp;&middot;&nbsp; Criado por {e['created_by']}
              </p>
            </td>
            <td style="padding:14px 16px;text-align:right;vertical-align:middle;white-space:nowrap">
              <span style="display:inline-block;padding:4px 12px;border-radius:999px;background:#dcfce7;color:#15803d;font-size:11px;font-weight:700">Vence hoje</span>
            </td>
          </tr>
        </table>"""

    body = f"""
      {_section_header('✅', 'Pendências que vencem hoje', date_str, '#059669')}
      <tr><td style="padding:20px 32px 28px">
        <p style="margin:0 0 18px;font-size:14px;color:#64748b;line-height:1.65">
          As seguintes tarefas têm prazo em <strong style="color:#0f172a">{date_str}</strong> e ainda não foram concluídas.
        </p>
        {cards}
      </td></tr>"""

    return _send(emails, f'{subject} — UneWorld Turismo', _wrap(body, '#059669'))
