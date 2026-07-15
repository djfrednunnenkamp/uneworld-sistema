"""Utilidades de log seguras (A-15).

Nunca logar PII (e-mail do destinatário, telefone, documento) em texto puro. Use
mask_email() quando precisar de rastreabilidade sem expor o dado."""


def mask_email(email):
    """'john.doe@example.com' -> 'j***@example.com'. Mantém 1ª letra + domínio,
    o suficiente pra depurar sem expor o e-mail inteiro nos logs."""
    if not email or '@' not in str(email):
        return '***'
    local, _, domain = str(email).partition('@')
    head = local[0] if local else ''
    return f'{head}***@{domain}'
