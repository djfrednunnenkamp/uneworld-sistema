"""Leitura da tabela de taxas das adquirentes.

As frases do domínio: "cada adquirente manda a sua tabela no mesmo arquivo",
"Cielo tem duas — máquina e link", "parcela 0 é o débito" e "cada uma escreve
o nome da bandeira do seu jeito".
"""
from decimal import Decimal

from django.test import SimpleTestCase

from config_api.card_fees import ler_tabela_de_taxas, nome_da_bandeira, nome_do_gateway


class NomesTest(SimpleTestCase):
    def test_bandeira_ganha_um_nome_so(self):
        for bruto in ('AMEX', 'American Express', 'amex', ' AMERICAN EXPRESS '):
            self.assertEqual(nome_da_bandeira(bruto), 'American Express')
        self.assertEqual(nome_da_bandeira('VISA'), 'Visa')
        self.assertEqual(nome_da_bandeira('HIPERCARD'), 'Hipercard')

    def test_bandeira_desconhecida_entra_como_veio(self):
        """Uma bandeira nova não pode derrubar a importação inteira."""
        self.assertEqual(nome_da_bandeira('CABAL'), 'Cabal')

    def test_titulo_vira_nome_de_gateway(self):
        self.assertEqual(nome_do_gateway('TAXAS STONE'), 'Stone')
        self.assertEqual(nome_do_gateway('CIELO LINK'), 'Cielo Link')


class LeituraTest(SimpleTestCase):
    def test_uma_tabela_simples(self):
        csv = '\n'.join([
            '"TAXAS STONE","","",""',
            '"Parcelas","Visa","Mastercard",""',
            '"1","3.13%","3.13%",""',
            '"2","4,11%","4.11%",""',
        ])
        gws, avisos = ler_tabela_de_taxas(csv)
        self.assertEqual([g['name'] for g in gws], ['Stone'])
        self.assertEqual(len(gws[0]['fees']), 4)
        self.assertEqual(avisos, [])
        visa1 = next(f for f in gws[0]['fees'] if f['brand'] == 'Visa' and f['installments'] == 1)
        self.assertEqual(visa1['percent'], Decimal('3.13'))
        # Vírgula decimal (como as adquirentes mandam) vale igual.
        visa2 = next(f for f in gws[0]['fees'] if f['brand'] == 'Visa' and f['installments'] == 2)
        self.assertEqual(visa2['percent'], Decimal('4.11'))

    def test_titulo_de_grupo_nao_vira_gateway(self):
        """"TAXAS CIELO" só anuncia as duas tabelas que vêm abaixo."""
        csv = '\n'.join([
            '"TAXAS CIELO","",""',
            '"CIELO MÁQUINA","",""',
            '"Parcelas","Visa",""',
            '"0","1.00%",""',
            '"1","2.08%",""',
            '"CIELO LINK","",""',
            '"Parcelas","Visa",""',
            '"1","2.10%",""',
        ])
        gws, _ = ler_tabela_de_taxas(csv)
        self.assertEqual([g['name'] for g in gws], ['Cielo Máquina', 'Cielo Link'])

    def test_parcela_zero_e_o_debito(self):
        csv = '"SAFRA","",""\n"Parcelas","Visa",""\n"0","0.89%",""\n"1","1.59%",""'
        gws, _ = ler_tabela_de_taxas(csv)
        por_parcela = {f['installments']: f['percent'] for f in gws[0]['fees']}
        self.assertEqual(por_parcela[0], Decimal('0.89'))
        self.assertEqual(por_parcela[1], Decimal('1.59'))

    def test_colunas_diferentes_por_gateway(self):
        """A Safra tem Hipercard; as outras, não."""
        csv = '\n'.join([
            '"STONE","",""', '"Parcelas","Visa",""', '"1","3.13%",""',
            '"SAFRA","","",""', '"Parcelas","HIPERCARD","VISA",""', '"1","2.59%","1.59%",""',
        ])
        gws, _ = ler_tabela_de_taxas(csv)
        self.assertEqual({f['brand'] for f in gws[0]['fees']}, {'Visa'})
        self.assertEqual({f['brand'] for f in gws[1]['fees']}, {'Hipercard', 'Visa'})

    def test_o_que_nao_da_para_ler_vira_aviso_e_nao_erro(self):
        csv = '\n'.join([
            '"STONE","",""',
            '"Parcelas","Visa",""',
            '"à vista","2.00%",""',      # parcela que não é número
            '"1","não sei",""',           # percentual que não é número
            '"2","3.00%",""',
        ])
        gws, avisos = ler_tabela_de_taxas(csv)
        self.assertEqual(len(gws[0]['fees']), 1)       # só a linha boa entrou
        self.assertEqual(len(avisos), 2)

    def test_titulo_sem_tabela_nao_cria_gateway_vazio(self):
        gws, _ = ler_tabela_de_taxas('"TAXAS FUTURAS","",""\n"","",""')
        self.assertEqual(gws, [])


class ArquivoRealTest(SimpleTestCase):
    """O arquivo que as adquirentes mandam de verdade, com as cinco tabelas."""

    CSV = None

    def test_le_as_cinco_tabelas(self):
        import pathlib
        caminho = pathlib.Path('/home/fred/Downloads/TAXAS-OPERADORAS.csv')
        if not caminho.exists():
            self.skipTest('arquivo de exemplo não está nesta máquina')
        bruto = caminho.read_bytes()
        try:
            texto = bruto.decode('utf-8-sig')
        except UnicodeDecodeError:
            texto = bruto.decode('latin-1')
        gws, avisos = ler_tabela_de_taxas(texto)
        self.assertEqual([g['name'] for g in gws],
                         ['Stone', 'Getnet', 'Cielo Máquina', 'Cielo Link', 'Safra'])
        self.assertEqual([len(g['fees']) for g in gws], [72, 48, 52, 64, 80])
        self.assertEqual(avisos, [])
