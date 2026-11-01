import { Peer } from "peerjs";

// 1. ID vem da URL: receive.html?cam=1 → "revocast-cam1"
const params = new URLSearchParams(window.location.search);
const meuId = `revocast-cam${params.get("cam") ?? "1"}`;

// 2. elemento de vídeo
const video = document.getElementById("remoto") as HTMLVideoElement;

// 3. cria o Peer com ID fixo
const peer = new Peer(meuId);

// 4. conectou ao servidor
peer.on("open", (id) => {
  console.log("Receptor pronto. Meu ID:", id);
});

// 5. alguém ligou
peer.on("call", (call) => {
  console.log("Chamada de:", call.peer);
  call.answer(); // sem stream: só recebo

  call.on("stream", (streamRemoto) => {
    if (video.srcObject !== streamRemoto) {
      video.srcObject = streamRemoto;
    }
  });
});

// 6. erros
peer.on("error", (err) => {
  console.error("Erro:", err.type, err);
});