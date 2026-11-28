/*
 * Frases fixas do vídeo divididas pelo `/camera` (`CameraNoAr.tsx`) e pela aba Ao vivo do painel (`AbaAoVivo.tsx`)
 * (VER-056, N4). Antes a aba importava `TEXTO_DA_CAMERA` do módulo da rota da câmera e, com ele, o emissor e o canal
 * comutável: com as rotas em pedaços separados, o painel puxaria o `/camera` junto. Este módulo não importa nada.
 * Nenhuma frase vem do navegador, do servidor ou do WebRTC (DES-001 §10.4, item 3).
 */

/** Sem conexão direta entre o celular e o computador (D6): o que fazer, na tela da câmera e no checklist da aba. */
export const FRASE_SEM_CONEXAO_DIRETA =
  'Sem conexão direta com o computador. Ponha o celular e o computador na mesma rede Wi-Fi (sem isolamento de clientes) ou use o roteador ou o hotspot do computador.'

/** Sem a trava de tela (Wake Lock): as instruções do DES-001 §10.4, item 3, na tela da câmera e no checklist da aba. */
export const TEXTO_SEM_TRAVA = Object.freeze({
  titulo: 'Este navegador não consegue manter a tela ligada.',
  iphone: 'iPhone: desligue o Modo de Pouca Energia (ele força o bloqueio em 30 s) e ponha o bloqueio automático em "Nunca".',
  android: 'Android: desligue a economia de bateria e ative "Permanecer ativo" em Opções do desenvolvedor, com o celular no carregador.',
})
