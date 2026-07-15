"""Sanitização de HTML rico salvo pelo editor (cláusulas de contrato, textos de
roteiro e termos) — anti-XSS (A-12).

O frontend usa um editor rico e precisa manter formatação básica (negrito,
listas, títulos, links), então texto puro não basta. Em vez disso, aplicamos uma
ALLOWLIST restrita com bleach ANTES de salvar: o que chega ao banco (e depois ao
PDF/preview) já está limpo. Bloqueia <script>, handlers on*, <iframe>/<object>/
<embed>/<style>, atributo style e URLs javascript:."""
import bleach

# Só tags de formatação — nada que carregue/execute recurso.
ALLOWED_TAGS = [
    'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
    'ul', 'ol', 'li', 'blockquote', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'sub', 'sup', 'pre', 'code',
]

# Atributos mínimos. Sem 'style' (bloqueia CSS perigoso) e sem 'on*' (handlers).
ALLOWED_ATTRS = {
    '*': ['class'],
    'a': ['href', 'title'],
}

# Só protocolos seguros em href — remove javascript:, data:, etc.
ALLOWED_PROTOCOLS = ['http', 'https', 'mailto', 'tel']


def sanitize_html(html):
    """Devolve o HTML limpo (mesma string se vazia/None). Tags fora da allowlist
    são removidas mantendo o texto interno (strip=True)."""
    if not html:
        return html
    return bleach.clean(
        html,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRS,
        protocols=ALLOWED_PROTOCOLS,
        strip=True,
        strip_comments=True,
    )


def sanitize_custom_clauses(clauses):
    """Sanitiza o campo `content` de cada cláusula personalizada (lista de dicts
    {name, content}) preservando o resto da estrutura. Usado em contratos e
    roteiros, onde o HTML é digitado inline junto do registro."""
    if not isinstance(clauses, list):
        return clauses
    out = []
    for c in clauses:
        if isinstance(c, dict):
            c = {**c}
            if 'content' in c:
                c['content'] = sanitize_html(c.get('content') or '')
            out.append(c)
        else:
            out.append(c)
    return out
