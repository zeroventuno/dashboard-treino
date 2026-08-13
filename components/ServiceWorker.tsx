"use client";

// Registra o service worker. Sem ele o Android não oferece "instalar app".
//
// Componente próprio, montado no layout: registrar dentro de uma página faria
// o registro depender de por onde a pessoa entrou.
import { useEffect } from "react";

export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Falha em silêncio de propósito: um service worker que não registra não
    // pode impedir ninguém de usar o painel — ele só existe para deixar a
    // partida mais rápida e o app instalável.
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);
  return null;
}
