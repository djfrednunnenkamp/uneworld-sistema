"""Envio do e-mail de resumo/lembrete do calendário via Resend."""
import resend
from django.conf import settings

TYPE_LABELS = {
    'trip':     ('✈️', 'Viagens',                '#1d4ed8', '#dbeafe'),
    'deadline': ('⏰', 'Prazos de confirmação',   '#b45309', '#fef3c7'),
    'birthday': ('🎂', 'Aniversários',            '#7c3aed', '#ede9fe'),
}


def _format_date(iso_str):
    y, m, d = iso_str.split('-')
    return f'{d}/{m}/{y}'


def _event_line(ev):
    if ev['type'] == 'trip' and ev['start'] != ev['end']:
        period = f"{_format_date(ev['start'])} – {_format_date(ev['end'])}"
    else:
        period = _format_date(ev['start'])
    subtitle = f" <span style=\"color:#94a3b8\">· {ev['subtitle']}</span>" if ev.get('subtitle') else ''
    return f"""
        <tr>
          <td style="padding:6px 0;color:#1e293b;font-size:13px">
            <strong>{period}</strong> — {ev['title']}{subtitle}
          </td>
        </tr>"""


def _build_sections(events):
    grouped = {}
    for ev in events:
        grouped.setdefault(ev['type'], []).append(ev)

    sections = []
    for key in ('trip', 'deadline', 'birthday'):
        items = grouped.get(key)
        if not items:
            continue
        icon, label, color, bg = TYPE_LABELS[key]
        rows = ''.join(_event_line(e) for e in items)
        sections.append(f"""
        <div style="margin:0 0 20px">
          <p style="display:inline-block;padding:4px 12px;border-radius:20px;background:{bg};color:{color};font-size:12px;font-weight:700;margin:0 0 8px">
            {icon} {label}
          </p>
          <table role="presentation" style="width:100%;border-collapse:collapse">
            {rows}
          </table>
        </div>""")

    if not sections:
        sections.append("""
        <p style="color:#94a3b8;font-size:13px">Nenhum evento encontrado para o período.</p>""")

    return ''.join(sections)


def send_calendar_summary(email: str, first_name: str, events: list, subject: str, intro: str) -> bool:
    """Envia um e-mail com o resumo de eventos do calendário (viagens, prazos, aniversários)."""
    resend.api_key = settings.RESEND_API_KEY
    if not settings.RESEND_API_KEY or settings.RESEND_API_KEY.startswith('re_sua_chave'):
        print(f"[EMAIL SIMULADO] {subject} para {email}: {len(events)} evento(s)")
        return True
    try:
        resend.Emails.send({
            "from":    settings.RESEND_FROM,
            "to":      [email],
            "subject": f'{subject} — UneWorld Turismo',
            "html": f"""
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f2f8;margin:0;padding:32px 16px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
    <div style="background:#1a2d4f;padding:24px 32px;text-align:center">
      <p style="color:#fff;font-size:22px;font-weight:700;margin:0">Une<span style="color:#6BA3C8">World</span></p>
      <p style="color:rgba(255,255,255,.5);font-size:12px;margin:4px 0 0;letter-spacing:.1em;text-transform:uppercase">Turismo</p>
    </div>
    <div style="padding:32px">
      <p style="color:#1e293b;font-size:16px;font-weight:600;margin:0 0 12px">Olá{f', {first_name}' if first_name else ''}!</p>
      <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0 0 24px">{intro}</p>
      {_build_sections(events)}
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


def _fmt_date(iso_str):
    if not iso_str:
        return ''
    parts = str(iso_str).split('-')
    if len(parts) == 3:
        return f'{parts[2]}/{parts[1]}/{parts[0]}'
    return str(iso_str)


def send_deadline_reminder(emails: list, deadline_date, entries: list) -> bool:
    """
    Envia lembrete de prazos de confirmação.

    entries: list of dicts com chaves:
        passenger_name  — nome do passageiro / bloqueio
        list_name       — nome da lista de passageiros
        pending_reason  — motivo da pendência (pode ser vazio)
        created_by      — nome de quem definiu o prazo
    """
    if not emails:
        return False

    resend.api_key = settings.RESEND_API_KEY
    date_str = _fmt_date(deadline_date)
    subject = f'Prazos de hoje ({date_str}) — UneWorld Turismo'

    if not settings.RESEND_API_KEY or settings.RESEND_API_KEY.startswith('re_sua_chave'):
        print(f"[EMAIL SIMULADO] {subject} para {emails}: {len(entries)} prazo(s)")
        return True

    rows_html = ''
    for e in entries:
        reason_html = ''
        if e.get('pending_reason'):
            reason_html = f'<p style="margin:4px 0 0;font-size:12px;color:#64748b">{e["pending_reason"]}</p>'
        rows_html += f"""
        <div style="padding:14px 0;border-bottom:1px solid #f1f5f9">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
            <div style="flex:1;min-width:0">
              <p style="margin:0;font-size:14px;font-weight:600;color:#1e293b">{e['passenger_name']}</p>
              <p style="margin:2px 0 0;font-size:12px;color:#64748b">{e['list_name']}</p>
              {reason_html}
            </div>
            <span style="flex-shrink:0;padding:3px 10px;background:#fef3c7;color:#b45309;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap">Vence hoje</span>
          </div>
          <p style="margin:6px 0 0;font-size:11px;color:#94a3b8">Prazo definido por {e.get('created_by','—')}</p>
        </div>"""

    html = f"""<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f2f8;margin:0;padding:32px 16px">
  <div style="max-width:540px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
    <div style="background:#1a2d4f;padding:24px 32px;text-align:center">
      <p style="color:#fff;font-size:22px;font-weight:700;margin:0">Une<span style="color:#6BA3C8">World</span></p>
      <p style="color:rgba(255,255,255,.5);font-size:12px;margin:4px 0 0;letter-spacing:.1em;text-transform:uppercase">Turismo</p>
    </div>
    <div style="padding:32px">
      <div style="display:flex;align-items:center;gap:10px;margin:0 0 8px">
        <span style="font-size:20px">⏰</span>
        <p style="margin:0;font-size:18px;font-weight:700;color:#1e293b">Prazos que vencem hoje</p>
      </div>
      <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0 0 24px">
        Os seguintes passageiros têm prazo de confirmação vencendo em <strong>{date_str}</strong> e ainda não confirmaram.
      </p>
      <div style="border:1px solid #e2e8f0;border-radius:10px;padding:0 16px">
        {rows_html}
        <div style="padding-bottom:2px"></div>
      </div>
    </div>
    <div style="background:#f8fafc;padding:16px 32px;text-align:center;border-top:1px solid #e2e8f0">
      <p style="color:#94a3b8;font-size:12px;margin:0">UneWorld Turismo · Sistema de Gestão</p>
    </div>
  </div>
</body>
</html>"""

    try:
        resend.Emails.send({
            "from":    settings.RESEND_FROM,
            "to":      emails,
            "subject": subject,
            "html":    html,
        })
        return True
    except Exception as e:
        print(f"[RESEND ERROR] {e}")
        return False


def send_task_reminder(emails: list, deadline_date, entries: list) -> bool:
    """Envia lembrete de tarefas/pendências de lista que vencem hoje."""
    if not emails:
        return False

    date_str = deadline_date.strftime('%d/%m/%Y') if hasattr(deadline_date, 'strftime') else str(deadline_date)
    subject  = f'Pendências que vencem hoje — {date_str}'

    rows_html = ''
    for e in entries:
        rows_html += f"""
        <div style="padding:14px 0;border-bottom:1px solid #f1f5f9">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="font-size:15px">📋</span>
            <span style="font-weight:600;color:#1e293b;font-size:14px">{e['title']}</span>
          </div>
          <div style="color:#64748b;font-size:13px;padding-left:23px">
            Lista: <strong>{e['list_name']}</strong> · Criado por {e['created_by']}
          </div>
        </div>"""

    html = f"""<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:Inter,Arial,sans-serif;background:#f8fafc">
  <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
    <div style="background:#1a2d4f;padding:24px 32px">
      <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">UneWorld Turismo</h1>
      <p style="color:rgba(255,255,255,.7);margin:4px 0 0;font-size:13px">Sistema de Gestão</p>
    </div>
    <div style="padding:28px 32px">
      <div style="display:flex;align-items:center;gap:10px;margin:0 0 8px">
        <span style="font-size:20px">✅</span>
        <p style="margin:0;font-size:18px;font-weight:700;color:#1e293b">Pendências que vencem hoje</p>
      </div>
      <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0 0 24px">
        As seguintes tarefas têm prazo em <strong>{date_str}</strong> e ainda não foram concluídas.
      </p>
      <div style="border:1px solid #e2e8f0;border-radius:10px;padding:0 16px">
        {rows_html}
        <div style="padding-bottom:2px"></div>
      </div>
    </div>
    <div style="background:#f8fafc;padding:16px 32px;text-align:center;border-top:1px solid #e2e8f0">
      <p style="color:#94a3b8;font-size:12px;margin:0">UneWorld Turismo · Sistema de Gestão</p>
    </div>
  </div>
</body>
</html>"""

    try:
        resend.Emails.send({
            "from":    settings.RESEND_FROM,
            "to":      emails,
            "subject": subject,
            "html":    html,
        })
        return True
    except Exception as e:
        print(f"[RESEND ERROR] {e}")
        return False
