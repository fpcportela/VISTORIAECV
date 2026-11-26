#!/bin/zsh -l
# Atalho do Mac: atualiza o sistema se tiver versão nova, traz os dados do Google Drive e abre o app.
# Deixe esta janela aberta enquanto usa. Para fechar: Ctrl+C e espere a mensagem "Liberado".
cd "$(dirname "$0")" || exit 1
node scripts/abrir.mjs 2>&1 | tee -ia ~/vistoria-app.log
