// Fluxograma do robô: desenha os blocos do fluxo em camadas (a partir do bloco 1), com as setas
// de cada bloco e de cada opção do menu. Clicar num bloco leva ao bloco na lista para editar.
// Também traz os modelos prontos de fluxo.

const L = 210, A = 74, GX = 36, GY = 64, MARGEM = 16; // tamanho do bloco e espaços

const COR = {
  inicio: '#0f766e', mensagem: '#2563eb', menu: '#7c3aed', pergunta: '#0891b2', ia: '#db2777',
  venda: '#16a34a', atendente: '#ea580c', fim: '#64748b', saida: '#94a3b8',
};
const NOME_TIPO = {
  mensagem: 'Mensagem', menu: 'Menu (botões)', pergunta: 'Pergunta', ia: 'IA', venda: 'Abre a venda', atendente: 'Atendente', fim: 'Encerra',
};

// Para onde cada bloco vai: [{ para: índice | 'fim', rotulo }]
function saidas(fluxo, b, n) {
  const alvo = (ir) => {
    if (ir) { const i = fluxo.findIndex((x) => x.id === ir); if (i >= 0) return i; }
    return n + 1 < fluxo.length ? n + 1 : 'fim';
  };
  if (b.tipo === 'menu') return (b.opcoes || []).map((o, k) => ({ para: alvo(o.ir), rotulo: `${k + 1}. ${o.rotulo || '…'}` }));
  if (['mensagem', 'pergunta', 'ia'].includes(b.tipo)) return [{ para: alvo(b.ir), rotulo: b.tipo === 'ia' ? 'terminou' : '' }];
  return [];
}

export function Fluxograma({ fluxo, unidades = 1, aoAbrir }) {
  if (!fluxo?.length) return null;
  // camadas pela menor distância a partir do bloco 1
  const nivel = new Map([[0, 1]]);
  const fila = [0];
  while (fila.length) {
    const n = fila.shift();
    for (const s of saidas(fluxo, fluxo[n], n)) {
      if (s.para !== 'fim' && !nivel.has(s.para)) { nivel.set(s.para, nivel.get(n) + 1); fila.push(s.para); }
    }
  }
  const soltos = fluxo.map((_, i) => i).filter((i) => !nivel.has(i));
  const ultimo = Math.max(...nivel.values());
  soltos.forEach((i) => nivel.set(i, ultimo + 2)); // blocos que nenhuma seta alcança ficam no fim
  const temFim = fluxo.some((b, n) => saidas(fluxo, b, n).some((s) => s.para === 'fim'));

  const camadas = [];
  camadas[0] = ['inicio'];
  for (const [i, nv] of [...nivel.entries()].sort((a, b) => a[0] - b[0])) (camadas[nv] ||= []).push(i);
  if (temFim) camadas.push(['fim']);
  const largura = Math.max(...camadas.filter(Boolean).map((c) => c.length));
  const W = MARGEM * 2 + largura * L + (largura - 1) * GX;
  const pos = new Map();
  let y = MARGEM;
  for (const c of camadas) {
    if (!c) { y += 24; continue; }
    const total = c.length * L + (c.length - 1) * GX;
    c.forEach((k, j) => pos.set(k, { x: (W - total) / 2 + j * (L + GX), y }));
    y += A + GY;
  }
  const H = y - GY + MARGEM;

  // setas
  const setas = [{ de: 'inicio', para: 0, rotulo: '' }];
  fluxo.forEach((b, n) => saidas(fluxo, b, n).forEach((s) => setas.push({ de: n, para: s.para, rotulo: s.rotulo })));
  const caminho = (a, b) => {
    const x1 = a.x + L / 2, y1 = a.y + A, x2 = b.x + L / 2, y2 = b.y;
    if (y2 > y1) { const m = (y1 + y2) / 2; return { d: `M${x1},${y1} C${x1},${m} ${x2},${m} ${x2},${y2}`, lx: (x1 + x2) / 2, ly: m }; }
    // volta para cima (ou para o lado): sai pela direita e entra por cima do bloco, tracejada
    const xr = Math.max(a.x, b.x) + L + GX / 2;
    return { volta: true, d: `M${a.x + L},${a.y + A / 2} C${xr + 40},${a.y + A / 2} ${x2 + 60},${b.y - 50} ${x2},${y2}`, lx: xr, ly: (a.y + b.y) / 2 + A / 2 };
  };

  const caixa = (k) => {
    const p = pos.get(k);
    if (k === 'inicio') {
      return (
        <div key="inicio" className="fx-no" style={{ left: p.x, top: p.y, width: L, height: A, borderColor: COR.inicio }}>
          <span className="fx-tipo" style={{ color: COR.inicio }}>Início</span>
          <strong>Boas-vindas</strong>
          <small>{unidades > 1 ? 'e escolha da unidade (botões)' : 'mensagem de boas-vindas'}</small>
        </div>
      );
    }
    if (k === 'fim') {
      return (
        <div key="fim" className="fx-no fx-saida" style={{ left: p.x, top: p.y, width: L, height: A, borderColor: COR.saida }}>
          <span className="fx-tipo">Fim do fluxo</span>
          <strong>Passa para um atendente</strong>
        </div>
      );
    }
    const b = fluxo[k];
    return (
      <button key={b.id} type="button" className={`fx-no${soltos.includes(k) ? ' fx-solto' : ''}`} onClick={() => aoAbrir?.(b.id)}
        style={{ left: p.x, top: p.y, width: L, height: A, borderColor: COR[b.tipo] }} title="Clique para editar este bloco">
        <span className="fx-tipo" style={{ color: COR[b.tipo] }}>{k + 1} · {NOME_TIPO[b.tipo]}</span>
        <strong>{b.nome || NOME_TIPO[b.tipo]}</strong>
        <small>{soltos.includes(k) ? 'nenhuma seta chega aqui' : (b.texto || '').slice(0, 60)}</small>
      </button>
    );
  };

  return (
    <div className="fx-quadro" role="img" aria-label="Fluxograma do atendimento do robô">
      <div className="fx-area" style={{ width: W + GX, height: H }}>
        <svg width={W + GX} height={H} className="fx-setas" aria-hidden="true">
          <defs>
            <marker id="fx-ponta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
            </marker>
          </defs>
          {setas.map((s, i) => {
            const a = pos.get(s.de), b = pos.get(s.para);
            if (!a || !b) return null;
            const c = caminho(a, b);
            return (
              <g key={i}>
                <path d={c.d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray={c.volta ? '5 4' : undefined} markerEnd="url(#fx-ponta)" />
                {s.rotulo && <text x={c.lx} y={c.ly} className="fx-rotulo" textAnchor="middle">{s.rotulo.length > 26 ? `${s.rotulo.slice(0, 25)}…` : s.rotulo}</text>}
              </g>
            );
          })}
        </svg>
        {[...pos.keys()].map(caixa)}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ modelos prontos
const P = (id, nome, campo, texto, obrigatorio = true, ir = '') => ({ id, tipo: 'pergunta', nome, campo, texto, obrigatorio, ir });
const MENU = (id, nome, texto, opcoes) => ({ id, tipo: 'menu', nome, texto, ir: '', opcoes: opcoes.map(([rotulo, ir]) => ({ rotulo, ir })) });
const VENDA = { id: 'venda', tipo: 'venda', nome: 'Abrir venda', texto: '', ir: '' };
const ATENDENTE = (id, texto) => ({ id, tipo: 'atendente', nome: 'Atendente', texto, ir: '' });

export const MODELOS = [
  {
    id: 'agendamento',
    nome: 'Agendamento de vistoria (menu com botões)',
    descricao: 'Menu: agendar, saber valores ou falar com atendente. Para agendar, pergunta nome, CPF, placa, tipo, serviço e o horário da agenda e abre a venda.',
    fluxo: () => [
      MENU('menu', 'Menu principal', 'Como posso ajudar?', [['Agendar vistoria', 'nome'], ['Saber valores', 'v_servico'], ['Falar com atendente', 'atendente']]),
      P('nome', 'Nome', 'nome', 'Qual é o seu nome completo?'),
      P('cpf', 'CPF/CNPJ', 'cpf_cnpj', 'Qual é o seu CPF ou CNPJ?', false),
      P('placa', 'Placa', 'placa', 'Qual é a placa do veículo?'),
      P('tipo', 'Tipo de veículo', 'tipo_veiculo', 'Qual é o tipo do veículo?'),
      P('servico', 'Serviço', 'servico', 'Qual serviço você precisa?'),
      P('horario', 'Horário', 'horario', 'Escolha o melhor horário para a vistoria:', true, 'venda'),
      VENDA,
      P('v_servico', 'Valores: serviço', 'servico', 'Qual serviço você quer saber o valor?'),
      P('v_tipo', 'Valores: tipo', 'tipo_veiculo', 'E qual é o tipo do veículo?', true, 'v_atendente'),
      ATENDENTE('v_atendente', 'Obrigado! Um atendente vai te passar o valor em instantes.'),
      ATENDENTE('atendente', 'Certo! Um atendente vai continuar a conversa com você em instantes.'),
    ],
  },
  {
    id: 'ia',
    nome: 'Atendimento com IA (agenda sozinho)',
    descricao: 'A IA conversa livre, usando o prompt e a base de conhecimento, junta nome, placa, serviço e horário e abre a venda.',
    fluxo: () => [
      { id: 'ia', tipo: 'ia', nome: 'Conversa com IA', texto: '', ir: 'venda',
        campos: [{ campo: 'nome', obrigatorio: true }, { campo: 'cpf_cnpj', obrigatorio: false }, { campo: 'placa', obrigatorio: true },
          { campo: 'tipo_veiculo', obrigatorio: true }, { campo: 'servico', obrigatorio: true }, { campo: 'horario', obrigatorio: true }] },
      VENDA,
    ],
  },
  {
    id: 'menu-ia',
    nome: 'Menu com botões + IA para dúvidas',
    descricao: 'Menu: agendar (a IA junta os dados e agenda), tirar dúvidas com a IA ou falar com atendente. Depois das dúvidas, oferece agendar.',
    fluxo: () => [
      MENU('menu', 'Menu principal', 'Como posso ajudar?', [['Agendar vistoria', 'ia_agendar'], ['Tirar dúvidas', 'ia_duvidas'], ['Falar com atendente', 'atendente']]),
      { id: 'ia_agendar', tipo: 'ia', nome: 'IA: agendar', texto: '', ir: 'venda',
        campos: [{ campo: 'nome', obrigatorio: true }, { campo: 'placa', obrigatorio: true }, { campo: 'servico', obrigatorio: true }, { campo: 'horario', obrigatorio: true }] },
      VENDA,
      { id: 'ia_duvidas', tipo: 'ia', nome: 'IA: dúvidas', texto: '', ir: 'mais', campos: [] },
      MENU('mais', 'Depois das dúvidas', 'Posso ajudar em algo mais?', [['Agendar vistoria', 'ia_agendar'], ['Falar com atendente', 'atendente'], ['Não, obrigado', 'fim']]),
      ATENDENTE('atendente', 'Certo! Um atendente vai continuar a conversa com você em instantes.'),
      { id: 'fim', tipo: 'fim', nome: 'Encerrar', texto: 'Obrigado pelo contato, {nome}! Quando precisar, é só chamar.', ir: '' },
    ],
  },
  {
    id: 'orcamento',
    nome: 'Orçamento rápido',
    descricao: 'Pergunta o serviço, o tipo e a placa e passa para um atendente mandar o valor.',
    fluxo: () => [
      P('servico', 'Serviço', 'servico', 'Qual serviço você precisa?'),
      P('tipo', 'Tipo de veículo', 'tipo_veiculo', 'Qual é o tipo do veículo?'),
      P('placa', 'Placa', 'placa', 'Qual é a placa do veículo?', false),
      ATENDENTE('atendente', 'Obrigado! Um atendente vai te passar o orçamento em instantes.'),
    ],
  },
  {
    id: 'triagem',
    nome: 'Triagem para o atendente',
    descricao: 'Só um menu com botões para saber o assunto e passar para uma pessoa.',
    fluxo: () => [
      MENU('menu', 'Assunto', 'Sobre o que você quer falar?', [['Agendar vistoria', 'a1'], ['Resultado / laudo', 'a2'], ['Outro assunto', 'a3']]),
      ATENDENTE('a1', 'Certo! Um atendente vai agendar com você em instantes.'),
      ATENDENTE('a2', 'Certo! Um atendente vai ver o seu laudo e já te responde.'),
      ATENDENTE('a3', 'Certo! Um atendente vai continuar a conversa com você em instantes.'),
    ],
  },
];
