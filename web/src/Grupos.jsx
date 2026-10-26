import { useEffect, useState } from 'react';
import { api } from './api.js';
import { cnpjValido, mascaraCnpj, mascaraTelefone } from './documentos.js';
import { semAcento } from './entrada.js';

const mascaraCep = (v) => String(v || '').replace(/\D/g, '').slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');
const enderecoVazio = (x) => ({ cep: mascaraCep(x?.cep), logradouro: x?.logradouro || '', numero: x?.numero || '', bairro: x?.bairro || '', cidade: x?.cidade || '', uf: x?.uf || '' });

// Endereço com CEP: ao completar o CEP, preenche rua, bairro, cidade e UF (o número fica para completar)
function CamposEndereco({ f, setF }) {
  const [aviso, setAviso] = useState('');
  async function mudarCep(valor) {
    const cep = mascaraCep(valor);
    setF((x) => ({ ...x, cep })); setAviso('');
    if (cep.length !== 9) return;
    setAviso('Buscando o CEP…');
    try {
      const r = await api(`/cep/${cep.replace(/\D/g, '')}`);
      setF((x) => ({ ...x, logradouro: semAcento(r.logradouro) || x.logradouro, bairro: semAcento(r.bairro) || x.bairro,
        cidade: semAcento(r.cidade) || x.cidade, uf: semAcento(r.uf) || x.uf }));
      setAviso(r.logradouro ? 'Endereço encontrado pelo CEP. Complete o número.' : 'CEP encontrado. Complete o endereço.');
    } catch (falha) { setAviso(falha.message); }
  }
  const muda = (campo) => (e) => setF((x) => ({ ...x, [campo]: e.target.value }));
  return (
    <>
      <div className="linha-campos cep">
        <label>CEP<input value={f.cep} inputMode="numeric" placeholder="00000-000" onChange={(e) => mudarCep(e.target.value)} /></label>
        <label>Rua<input value={f.logradouro} onChange={muda('logradouro')} /></label>
      </div>
      {aviso && <small className="aviso-receita">{aviso}</small>}
      <div className="linha-campos">
        <label>Bairro<input value={f.bairro} onChange={muda('bairro')} /></label>
        <label className="campo-uf">Número<input value={f.numero} onChange={muda('numero')} /></label>
      </div>
      <div className="linha-campos">
        <label>Cidade<input value={f.cidade} onChange={muda('cidade')} /></label>
        <label className="campo-uf">UF<input value={f.uf} maxLength={2} onChange={(e) => setF((x) => ({ ...x, uf: e.target.value.replace(/[^A-Za-z]/g, '') }))} /></label>
      </div>
    </>
  );
}

// Grupos (ex.: VISÃO TOTAL) e as unidades de cada grupo, com ou sem CNPJ próprio.
// O master cadastra tudo; os demais só veem as unidades do próprio grupo.

export default function Grupos() {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [editando, setEditando] = useState(null); // { tipo: 'grupo' | 'unidade', item, grupo }

  const carregar = () => api('/grupos').then((d) => { setDados(d); setErro(''); }).catch((f) => setErro(f.message));
  useEffect(() => { carregar(); }, []);

  const master = dados?.master;
  return (
    <>
      <div className="cabecalho">
        <h1>Grupos e unidades</h1>
        {master && <button className="botao-primario" onClick={() => setEditando({ tipo: 'grupo', item: null })}>+ Novo grupo</button>}
      </div>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {!dados ? <p className="cinza">Carregando…</p> : dados.grupos.length === 0 ? <p className="cinza vazio">Nenhum grupo cadastrado.</p> : (
        <div className="lista-grupos">
          {dados.grupos.map((g) => (
            <section key={g.id} className="cartao grupo-cartao">
              <div className="grupo-topo">
                <span>
                  <strong>{g.nome_fantasia || g.razao_social}</strong>
                  {!g.ativo && <span className="etiqueta inativa">Inativo</span>}
                  <small className="cinza">{[g.nome_fantasia && g.razao_social !== g.nome_fantasia && g.razao_social, g.cnpj ? `CNPJ ${mascaraCnpj(g.cnpj)}` : 'Sem CNPJ'].filter(Boolean).join(' · ')}</small>
                </span>
                {master && (
                  <span className="acoes-cabecalho">
                    <button className="botao-contorno" onClick={() => setEditando({ tipo: 'grupo', item: g })}>Editar grupo</button>
                    <button className="botao-primario" onClick={() => setEditando({ tipo: 'unidade', item: null, grupo: g })}>+ Unidade</button>
                  </span>
                )}
              </div>
              {g.unidades.length === 0 ? <p className="cinza">Nenhuma unidade ainda.</p> : (
                <ul className="lista-unidades">
                  {g.unidades.map((u) => (
                    <li key={u.id}>
                      <button disabled={!master} onClick={() => setEditando({ tipo: 'unidade', item: u, grupo: g })}>
                        <span className="codigo-unidade">{u.codigo}</span>
                        <span>
                          <strong>{u.nome}</strong>
                          <small className="cinza">{[u.cnpj ? `CNPJ ${mascaraCnpj(u.cnpj)}` : 'Usa o CNPJ do grupo', u.cidade && `${u.cidade}${u.uf ? `/${u.uf}` : ''}`, u.telefone && mascaraTelefone(u.telefone)].filter(Boolean).join(' · ')}</small>
                        </span>
                        {!u.ativo && <span className="etiqueta inativa">Inativa</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
      {editando?.tipo === 'grupo' && <EditorGrupo item={editando.item} aoFechar={() => setEditando(null)} aoSalvar={() => { setEditando(null); carregar(); }} />}
      {editando?.tipo === 'unidade' && <EditorUnidade item={editando.item} grupo={editando.grupo} aoFechar={() => setEditando(null)} aoSalvar={() => { setEditando(null); carregar(); }} />}
    </>
  );
}

function Modal({ titulo, aoFechar, children }) {
  return (
    <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && aoFechar()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="modal-topo">
          <h2>{titulo}</h2>
          <button className="fechar" onClick={aoFechar} aria-label="Fechar">×</button>
        </div>
        {children}
      </section>
    </div>
  );
}

// Reduz a imagem no navegador (até 480 × 200, PNG) para o logo ficar leve
async function reduzirLogo(arquivo) {
  if (!/^image\/(png|jpeg|webp)$/.test(arquivo.type)) throw new Error('Use uma imagem PNG ou JPG.');
  if (arquivo.size > 8 * 1024 * 1024) throw new Error('A imagem é grande demais (máximo 8 MB).');
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise((ok, falha) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => falha(new Error('Não foi possível abrir a imagem.')); i.src = url; });
    const escala = Math.min(1, 480 / img.width, 200 / img.height);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * escala)); c.height = Math.max(1, Math.round(img.height * escala));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    let dados = c.toDataURL('image/png');
    if (dados.length > 380000) dados = c.toDataURL('image/jpeg', 0.85);
    return dados;
  } finally { URL.revokeObjectURL(url); }
}

function EditorGrupo({ item, aoFechar, aoSalvar }) {
  const [f, setF] = useState({ razao_social: item?.razao_social || '', nome_fantasia: item?.nome_fantasia || '', cnpj: item?.cnpj ? mascaraCnpj(item.cnpj) : '', ativo: item?.ativo ?? true, logo: item?.logo || '', ...enderecoVazio(item) });
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function salvar(e) {
    e.preventDefault();
    if (f.cnpj && !cnpjValido(f.cnpj)) return setErro('CNPJ inválido. Confira os números.');
    setSalvando(true); setErro('');
    try {
      await api(item ? `/grupos/${item.id}` : '/grupos', { metodo: item ? 'PUT' : 'POST', corpo: f });
      aoSalvar();
    } catch (falha) { setErro(falha.message); setSalvando(false); }
  }
  return (
    <Modal titulo={item ? 'Editar grupo' : 'Novo grupo'} aoFechar={aoFechar}>
      <form className="formulario" onSubmit={salvar}>
        <label>Nome do grupo (razão social)<input value={f.razao_social} onChange={(e) => setF({ ...f, razao_social: e.target.value })} required autoFocus /></label>
        <label>Nome fantasia<input value={f.nome_fantasia} onChange={(e) => setF({ ...f, nome_fantasia: e.target.value })} placeholder="Opcional" /></label>
        <div className="campo-logo">
          <span className="rotulo-campo">Logo da empresa</span>
          <div className="linha-logo">
            <span className="previa-logo">{f.logo ? <img src={f.logo} alt="Logo do grupo" /> : <small className="cinza">Sem logo</small>}</span>
            <label className="botao-contorno pequeno">
              {f.logo ? 'Trocar' : 'Escolher imagem'}
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async (e) => {
                const arq = e.target.files?.[0]; e.target.value = '';
                if (!arq) return;
                try { setF((x) => ({ ...x, logo: '' })); const logo = await reduzirLogo(arq); setF((x) => ({ ...x, logo })); setErro(''); } catch (falha) { setErro(falha.message); }
              }} />
            </label>
            {f.logo && <button type="button" className="botao-texto" onClick={() => setF({ ...f, logo: '' })}>Remover</button>}
          </div>
          <small className="cinza">Aparece no menu, abaixo de Vistoria ECV, e no cabeçalho dos relatórios em PDF.</small>
        </div>
        <label>CNPJ do grupo<input value={f.cnpj} inputMode="numeric" placeholder="Opcional" onChange={(e) => setF({ ...f, cnpj: mascaraCnpj(e.target.value) })} /></label>
        <span className="rotulo-campo">Endereço do grupo</span>
        <CamposEndereco f={f} setF={setF} />
        {item && <label className="linha-check"><input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /> Grupo ativo</label>}
        {!item && <p className="cinza ajuda">O grupo já nasce com o perfil Administrador, o plano de contas e os tipos de arquivo. Depois cadastre as unidades e os usuários dele.</p>}
        {erro && <p className="erro" role="alert">{erro}</p>}
        <div className="acoes-modal">
          <button type="button" className="botao-contorno" onClick={aoFechar}>Cancelar</button>
          <button className="botao-primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </Modal>
  );
}

function EditorUnidade({ item, grupo, aoFechar, aoSalvar }) {
  const [f, setF] = useState({ nome: item?.nome || '', cnpj: item?.cnpj ? mascaraCnpj(item.cnpj) : '', telefone: item?.telefone ? mascaraTelefone(item.telefone) : '',
    ...enderecoVazio(item), ativo: item?.ativo ?? true });
  const [proprio, setProprio] = useState(Boolean(item?.cnpj));
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function salvar(e) {
    e.preventDefault();
    if (proprio && !cnpjValido(f.cnpj)) return setErro('CNPJ inválido. Confira os números.');
    setSalvando(true); setErro('');
    try {
      const corpo = { ...f, cnpj: proprio ? f.cnpj : '', telefone: f.telefone.replace(/\D/g, ''), grupo_id: grupo.id };
      await api(item ? `/unidades/${item.id}` : '/unidades', { metodo: item ? 'PUT' : 'POST', corpo });
      aoSalvar();
    } catch (falha) { setErro(falha.message); setSalvando(false); }
  }
  return (
    <Modal titulo={item ? `Unidade ${item.codigo}` : `Nova unidade em ${grupo.nome_fantasia || grupo.razao_social}`} aoFechar={aoFechar}>
      <form className="formulario" onSubmit={salvar}>
        <label>Nome da unidade<input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} required autoFocus placeholder="Ex.: LOJA 3 · CENTRO" /></label>
        <label className="linha-check"><input type="checkbox" checked={proprio} onChange={(e) => setProprio(e.target.checked)} /> Esta unidade tem CNPJ próprio</label>
        {proprio && <label>CNPJ da unidade<input value={f.cnpj} inputMode="numeric" required onChange={(e) => setF({ ...f, cnpj: mascaraCnpj(e.target.value) })} /></label>}
        <label>Telefone<input value={f.telefone} inputMode="tel" placeholder="Opcional" onChange={(e) => setF({ ...f, telefone: mascaraTelefone(e.target.value) })} /></label>
        <span className="rotulo-campo">Endereço da unidade</span>
        <CamposEndereco f={f} setF={setF} />
        <small className="cinza">O robô do WhatsApp mostra este endereço quando o cliente escolhe a unidade e na confirmação do agendamento.</small>
        {item && <label className="linha-check"><input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /> Unidade ativa</label>}
        {!item && <p className="cinza ajuda">A unidade ganha um código (0001, 0002…) e um centro de custo próprio.</p>}
        {erro && <p className="erro" role="alert">{erro}</p>}
        <div className="acoes-modal">
          <button type="button" className="botao-contorno" onClick={aoFechar}>Cancelar</button>
          <button className="botao-primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </Modal>
  );
}
