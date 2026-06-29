"""Verificação de e-mail no cadastro.

Vai além do formato: confirma que o DOMÍNIO existe e aceita e-mail (registros
MX, com queda para registro A), e sugere a correção de domínios digitados
errado (ex.: gmial.com → gmail.com). Pensado para os e-mails de TERCEIROS que
o sistema cadastra (passageiro, agência, pagador), onde não dá para mandar um
link de confirmação.

A consulta de DNS pode falhar por motivos da nossa rede (timeout). Nesses
casos NÃO reprovamos o e-mail — só reprovamos quando o domínio realmente não
existe (NXDOMAIN) ou não tem como receber e-mail. Assim uma instabilidade de
rede nunca impede um cadastro legítimo.
"""
import re

import dns.exception
import dns.resolver
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email as _django_validate_email

# Domínios mais usados — base para sugerir correção de quem digita errado.
COMMON_DOMAINS = [
    'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.com.br',
    'icloud.com', 'live.com', 'bol.com.br', 'uol.com.br', 'terra.com.br',
    'globo.com', 'me.com', 'msn.com', 'protonmail.com', 'gmail.com.br',
]

# Tempo curto de DNS para não travar o cadastro; 2 tentativas.
_RESOLVER = dns.resolver.Resolver()
_RESOLVER.lifetime = 4.0
_RESOLVER.timeout = 2.0


def _levenshtein(a, b):
    """Distância de edição entre duas strings (para achar o domínio parecido)."""
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def suggest_domain(domain):
    """Sugere um domínio comum quando o digitado está bem perto de um deles
    (ex.: 'gmial.com' → 'gmail.com'). Retorna None se já for válido ou distante."""
    domain = (domain or '').lower().strip()
    if not domain or domain in COMMON_DOMAINS:
        return None
    best, best_dist = None, 99
    for cand in COMMON_DOMAINS:
        d = _levenshtein(domain, cand)
        if d < best_dist:
            best, best_dist = cand, d
    # só sugere se for um erro pequeno (1 ou 2 caracteres de diferença)
    return best if best_dist and best_dist <= 2 else None


def _domain_accepts_mail(domain):
    """(aceita, certeza) — aceita: o domínio tem como receber e-mail?
    certeza=False quando o DNS não respondeu (timeout/erro de rede): nesse caso
    não dá para afirmar nada, então o chamador deve liberar o cadastro."""
    try:
        answers = _RESOLVER.resolve(domain, 'MX')
        return (len(answers) > 0, True)
    except dns.resolver.NXDOMAIN:
        return (False, True)            # domínio não existe → reprovar
    except dns.resolver.NoAnswer:
        # sem MX: alguns domínios recebem e-mail pelo registro A (RFC 5321).
        try:
            _RESOLVER.resolve(domain, 'A')
            return (True, True)
        except dns.resolver.NXDOMAIN:
            return (False, True)
        except (dns.exception.DNSException, Exception):
            return (True, False)        # incerto → não reprovar
    except (dns.exception.DNSException, Exception):
        return (True, False)            # timeout/erro de rede → não reprovar


def check_email(email):
    """Verifica um e-mail e devolve um veredito amigável:
        {valid, reason, suggestion, suggested_email}
    - valid: passou na verificação que conseguimos fazer
    - reason: 'ok' | 'format' | 'domain' | 'unverified'
    - suggestion: domínio sugerido (ou None)
    - suggested_email: e-mail já com o domínio corrigido (ou None)
    """
    email = (email or '').strip()
    if not email:
        return {'valid': False, 'reason': 'format', 'suggestion': None, 'suggested_email': None}

    try:
        _django_validate_email(email)
    except DjangoValidationError:
        return {'valid': False, 'reason': 'format', 'suggestion': None, 'suggested_email': None}

    local, _, domain = email.rpartition('@')
    domain = domain.lower()
    suggestion = suggest_domain(domain)
    suggested_email = f'{local}@{suggestion}' if suggestion else None

    accepts, sure = _domain_accepts_mail(domain)
    if sure and not accepts:
        return {'valid': False, 'reason': 'domain',
                'suggestion': suggestion, 'suggested_email': suggested_email}
    if not sure:
        # não conseguimos confirmar o domínio (DNS indisponível): libera, mas avisa.
        return {'valid': True, 'reason': 'unverified',
                'suggestion': suggestion, 'suggested_email': suggested_email}
    # domínio ok — ainda pode haver um erro de digitação parecido (sugere sem reprovar).
    return {'valid': True, 'reason': 'ok',
            'suggestion': suggestion, 'suggested_email': suggested_email}
