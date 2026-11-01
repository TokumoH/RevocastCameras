import { Peer } from "peerjs";

// 1. para quem ligar: send.html?cam=1 → "revocast-cam1"
const params = new URLSearchParams(window.location.search);
const destino = `revocast-cam${params.get("cam") ?? "1"}`;

// 2. elementos
const botao = document.getElementById("iniciar") as HTMLButtonElement;
const previa = document.getElementById("previa") as HTMLVideoElement;

// 3. tudo começa no clique
botao.addEventListener("click", async () => {
  botao.disabled = true;

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  previa.srcObject = stream;

  const peer = new Peer(); // sem ID: o servidor gera um

  peer.on("open", (meuId) => {
    console.log("Emissor", meuId, "ligando para", destino);
    peer.call(destino, stream);
  });

  peer.on("error", (err) => {
    console.error("Erro:", err.type, err);
    botao.disabled = false;
  });
});