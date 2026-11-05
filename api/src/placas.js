// Consulta de placa pela API Placas (apiplacas.com.br / wdapi2.com.br).
// O token fica só no servidor (variável API_PLACAS_TOKEN), nunca no app.

const BASE = process.env.API_PLACAS_URL || 'https://wdapi2.com.br/v3';
const ROTA = process.env.API_PLACAS_ROTA || 'completa';
export const CACHE_DIAS = Number(process.env.API_PLACAS_CACHE_DIAS || 30);

const ERROS = {
  400: 'Placa inválida.',
  401: 'Token da API Placas inválido ou ausente. Confira o API_PLACAS_TOKEN.',
  402: 'Saldo insuficiente na API Placas. Recarregue a conta.',
  404: 'Placa não encontrada.',
  503: 'A API Placas está fora do ar no momento. Tente de novo em alguns minutos.',
};

export class ErroPlaca extends Error {
  constructor(mensagem, status, requestId) {
    super(mensagem);
    this.status = status;
    this.requestId = requestId;
  }
}

// "abc-1d23" → "ABC1D23"; devolve null se não for placa antiga nem Mercosul
export function normalizarPlaca(texto) {
  const placa = String(texto || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa) ? placa : null;
}

const vazioParaNull = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
const inteiro = (v) => (/^\d{4}$/.test(String(v || '')) ? Number(v) : null);

function tipoVeiculo(basico) {
  const t = `${basico.tipo || ''} ${basico.especie || ''} ${basico.tipoVeiculo || ''}`
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/motociclo|motocicleta|motoneta|ciclomotor|triciclo|quadriciclo/.test(t)) return 'moto';
  if (/caminhao|trator|onibus|micro-onibus|reboque|semi-reboque|carga/.test(t)) return 'caminhao';
  if (/automovel|camioneta|caminhonete|utilitario|passageiro/.test(t)) return 'carro';
  return 'outro';
}

// Converte a resposta da API nos campos da tabela veiculos
export function mapearVeiculo(resposta) {
  const b = resposta.basico?.dados || {};
  return {
    tipo: tipoVeiculo(b),
    marca: vazioParaNull(b.marca),
    modelo: vazioParaNull(b.modelo),
    versao: vazioParaNull(b.marcamodelo),
    ano_fabricacao: inteiro(b.ano),
    ano_modelo: inteiro(b.anoModelo),
    cor: vazioParaNull(b.cor),
    combustivel: vazioParaNull(b.combustivel),
    chassi: vazioParaNull(resposta.chassi?.dados?.chassi),
    renavam: vazioParaNull(resposta.renavam?.dados?.renavam),
    motor: vazioParaNull(resposta.motor?.dados?.motor || b.motor),
    municipio: vazioParaNull(b.municipio),
    uf: vazioParaNull(b.uf)?.slice(0, 2) || null,
  };
}

export async function consultarApiPlacas(placa) {
  const token = process.env.API_PLACAS_TOKEN;
  if (!token) {
    throw new ErroPlaca('A consulta de placa ainda não foi configurada. Coloque o API_PLACAS_TOKEN no arquivo api/.env.', 503);
  }
  let resposta;
  try {
    resposta = await fetch(`${BASE}/${ROTA}/${placa}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ErroPlaca('Não foi possível falar com a API Placas. Verifique a internet.', 503);
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok || dados.error) {
    const status = resposta.ok ? 502 : resposta.status;
    throw new ErroPlaca(ERROS[status] || dados.message || 'Erro na API Placas.', status, dados.request_id);
  }
  if (!dados.basico || dados.basico.error) {
    throw new ErroPlaca(dados.basico?.message || 'Placa não encontrada.', 404, dados.request_id);
  }
  return dados;
}
