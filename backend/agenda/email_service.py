"""Envio de e-mails transacionais do calendário via Resend."""
import resend
from datetime import timedelta
from django.conf import settings

from ._logo import LOGO_CID, LOGO_B64_CONTENT, get_logo_src


# ── Helpers de template ───────────────────────────────────────────────────────

def _header() -> str:
    src, _ = get_logo_src()
    return f"""
      <tr>
        <td style="background:#ffffff;padding:24px 32px 20px;text-align:center;border-bottom:3px solid #1a2d4f">
          <img src="{src}" alt="UneWorld Turismo" width="160" height="104"
               style="display:block;margin:0 auto;max-width:160px;height:auto;border:0" />
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


def _subsection(icon: str, title: str, color: str) -> str:
    return f"""
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px">
        <tr>
          <td style="padding:10px 0 8px">
            <span style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:999px;background:{color}18;color:{color};font-size:12px;font-weight:700;letter-spacing:.02em">
              {icon}&nbsp;{title}
            </span>
          </td>
        </tr>
      </table>"""


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
    _, use_cid = get_logo_src()
    payload = {
        "from": settings.RESEND_FROM,
        "to": to if isinstance(to, list) else [to],
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
        resend.Emails.send(payload)
        return True
    except Exception as e:
        print(f"[RESEND ERROR] {e}")
        return False


def _fmt(iso_str) -> str:
    if not iso_str:
        return ''
    parts = str(iso_str).split('-')
    return f'{parts[2]}/{parts[1]}/{parts[0]}' if len(parts) == 3 else str(iso_str)


# ── Card builders (reutilizáveis entre templates individuais e digest) ─────────

def _deadline_cards(entries: list, badge: str, badge_bg: str, badge_fg: str) -> str:
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
    return cards


def _task_cards(entries: list) -> str:
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
    return cards


def _birthday_cards(entries: list) -> str:
    cards = ''
    for e in entries:
        age_html = f'<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:#ede9fe;color:#7c3aed;font-size:11px;font-weight:700">{e["age"]} anos</span>' if e.get('age') else ''
        cards += f"""
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;border:1px solid #e2e8f0;border-left:4px solid #7c3aed;border-radius:10px;overflow:hidden">
          <tr>
            <td style="padding:14px 16px">
              <p style="margin:0;font-size:14px;font-weight:700;color:#0f172a">{e['name']}</p>
              <p style="margin:4px 0 0;font-size:12px;color:#64748b">
                Nascimento: <strong>{e['birth_date']}</strong>
              </p>
            </td>
            <td style="padding:14px 16px;text-align:right;vertical-align:middle">{age_html}</td>
          </tr>
        </table>"""
    return cards


# ── Digest diário consolidado ─────────────────────────────────────────────────

def send_daily_digest(
    email: str,
    today,
    deadline_today: list,
    deadline_2d: list,
    tasks: list,
    birthdays: list,
) -> bool:
    """Um único e-mail por destinatário com todas as notificações do dia."""
    if not email:
        return False

    date_str = today.strftime('%d/%m/%Y') if hasattr(today, 'strftime') else str(today)
    d2_str   = (today + timedelta(days=2)).strftime('%d/%m/%Y') if hasattr(today, 'strftime') else ''

    total = len(deadline_today) + len(deadline_2d) + len(tasks) + len(birthdays)
    if total == 0:
        return False

    subject = f'Resumo do dia — {date_str}'

    inner = ''

    if deadline_today:
        inner += _subsection('⏰', f'Prazos que vencem hoje ({date_str})', '#b45309')
        inner += f'<p style="margin:0 0 12px;font-size:13px;color:#64748b">Passageiros com prazo de confirmação em <strong style="color:#0f172a">{date_str}</strong> que ainda não confirmaram.</p>'
        inner += _deadline_cards(deadline_today, 'Vence hoje', '#fef3c7', '#b45309')

    if deadline_2d:
        margin_top = '20px' if deadline_today else '0'
        inner += f'<div style="margin-top:{margin_top}">'
        inner += _subsection('📅', f'Prazos em 2 dias ({d2_str})', '#1d4ed8')
        inner += f'<p style="margin:0 0 12px;font-size:13px;color:#64748b">Passageiros com prazo de confirmação em <strong style="color:#0f172a">{d2_str}</strong> que ainda não confirmaram.</p>'
        inner += _deadline_cards(deadline_2d, 'Em 2 dias', '#dbeafe', '#1d4ed8')
        inner += '</div>'

    if tasks:
        margin_top = '20px' if (deadline_today or deadline_2d) else '0'
        inner += f'<div style="margin-top:{margin_top}">'
        inner += _subsection('✅', f'Pendências que vencem hoje ({date_str})', '#059669')
        inner += f'<p style="margin:0 0 12px;font-size:13px;color:#64748b">Tarefas com prazo em <strong style="color:#0f172a">{date_str}</strong> ainda não concluídas.</p>'
        inner += _task_cards(tasks)
        inner += '</div>'

    if birthdays:
        margin_top = '20px' if (deadline_today or deadline_2d or tasks) else '0'
        inner += f'<div style="margin-top:{margin_top}">'
        inner += _subsection('🎂', f'Aniversários de hoje ({date_str})', '#7c3aed')
        inner += f'<p style="margin:0 0 12px;font-size:13px;color:#64748b">Passageiros que fazem aniversário hoje, <strong style="color:#0f172a">{date_str}</strong>.</p>'
        inner += _birthday_cards(birthdays)
        inner += '</div>'

    body = f"""
      {_section_header('📋', 'Resumo do dia', date_str, '#2e6db4')}
      <tr><td style="padding:20px 32px 28px">{inner}</td></tr>"""

    return _send(email, f'{subject} — UneWorld Turismo', _wrap(body, '#2e6db4'))


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


# ── Templates individuais (mantidos para compatibilidade) ─────────────────────

def send_deadline_reminder(emails: list, deadline_date, entries: list, days_ahead: int = 0) -> bool:
    if not emails:
        return False
    date_str = _fmt(deadline_date)
    if days_ahead == 0:
        subject, title, badge, badge_bg, badge_fg = (
            f'Prazos que vencem hoje ({date_str})', 'Prazos que vencem hoje', 'Vence hoje', '#fef3c7', '#b45309',
        )
    else:
        subject, title, badge, badge_bg, badge_fg = (
            f'Prazos que vencem em {days_ahead} dias ({date_str})', f'Prazos em {days_ahead} dias',
            f'Em {days_ahead} dias', '#dbeafe', '#1d4ed8',
        )
    body = f"""
      {_section_header('⏰', title, f'Data limite: {date_str}', '#b45309')}
      <tr><td style="padding:20px 32px 28px">
        <p style="margin:0 0 18px;font-size:14px;color:#64748b;line-height:1.65">
          Os seguintes passageiros têm prazo de confirmação em <strong style="color:#0f172a">{date_str}</strong> e ainda não confirmaram.
        </p>
        {_deadline_cards(entries, badge, badge_bg, badge_fg)}
      </td></tr>"""
    return _send(emails, f'{subject} — UneWorld Turismo', _wrap(body, '#b45309'))


def send_task_reminder(emails: list, deadline_date, entries: list) -> bool:
    if not emails:
        return False
    date_str = deadline_date.strftime('%d/%m/%Y') if hasattr(deadline_date, 'strftime') else str(deadline_date)
    subject  = f'Pendências que vencem hoje ({date_str})'
    body = f"""
      {_section_header('✅', 'Pendências que vencem hoje', date_str, '#059669')}
      <tr><td style="padding:20px 32px 28px">
        <p style="margin:0 0 18px;font-size:14px;color:#64748b;line-height:1.65">
          As seguintes tarefas têm prazo em <strong style="color:#0f172a">{date_str}</strong> e ainda não foram concluídas.
        </p>
        {_task_cards(entries)}
      </td></tr>"""
    return _send(emails, f'{subject} — UneWorld Turismo', _wrap(body, '#059669'))


def send_birthday_reminder(emails: list, today_date, entries: list) -> bool:
    if not emails:
        return False
    date_str = today_date.strftime('%d/%m/%Y') if hasattr(today_date, 'strftime') else str(today_date)
    subject  = f'Aniversários de hoje ({date_str})'
    body = f"""
      {_section_header('🎂', 'Aniversários de hoje', date_str, '#7c3aed')}
      <tr><td style="padding:20px 32px 28px">
        <p style="margin:0 0 18px;font-size:14px;color:#64748b;line-height:1.65">
          Os seguintes passageiros fazem aniversário hoje, <strong style="color:#0f172a">{date_str}</strong>.
        </p>
        {_birthday_cards(entries)}
      </td></tr>"""
    return _send(emails, f'{subject} — UneWorld Turismo', _wrap(body, '#7c3aed'))
