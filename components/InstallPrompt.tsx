"use client";

// Convite para instalar o painel como app.
//
// Sem isto, instalar depende de o atleta achar sozinho um item escondido no
// menu do navegador — coisa que quase ninguém faz. Com isto, é um botão.
//
// Os dois sistemas se comportam de formas diferentes e não dá para fingir que
// não: o Android entrega um evento que abre a caixa de instalação de verdade;
// o iOS não tem API nenhuma, então lá o máximo honesto é ENSINAR o caminho.
// Um botão que não instala nada seria pior que nenhum botão.
import { useEffect, useState } from "react";
import { translator, type Locale } from "@/lib/i18n";

const DISMISSED = "trak_install_dismissed";

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPrompt({ locale }: { locale: Locale }) {
  const tr = translator(locale);
  const [evt, setEvt] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [show, setShow] = useState(false);
  const [howTo, setHowTo] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISSED)) return;

    // Já instalado: nos dois sistemas, ainda que por caminhos diferentes.
    const installed =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (installed) return;

    // iPad novo se identifica como Mac, então a checagem de toque entra junto.
    const ua = navigator.userAgent;
    const isIos = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    // Só o Safari instala no iOS. Dentro do navegador do Instagram ou do
    // Gmail o caminho simplesmente não existe, e ensiná-lo ali seria mentir.
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|Instagram|FBAN|FBAV|Line/.test(ua);

    if (isIos && isSafari) {
      setIos(true);
      setShow(true);
      return;
    }

    const onPrompt = (e: Event) => {
      // Segura o evento: sem isto o Chrome mostra a própria barra, no momento
      // que ele escolher, e perdemos a chance de oferecer em lugar melhor.
      e.preventDefault();
      setEvt(e as InstallEvent);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  function dismiss() {
    // Para sempre, não por sessão: quem disse não uma vez não precisa ser
    // perguntado toda semana.
    localStorage.setItem(DISMISSED, "1");
    setShow(false);
  }

  async function install() {
    if (!evt) return;
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    // Recusar aqui é a mesma resposta de fechar o convite.
    if (outcome === "dismissed") dismiss();
    else setShow(false);
  }

  if (!show) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
      <div className="min-w-[180px] flex-1">
        <p className="text-[13px] font-semibold text-[var(--text)]">{tr("install.title")}</p>
        <p className="text-[11.5px] text-[var(--text-faint)]">{tr("install.sub")}</p>
      </div>

      {ios ? (
        <button
          type="button"
          onClick={() => setHowTo((v) => !v)}
          className="rounded-[10px] bg-[var(--lime)] px-3.5 py-1.5 text-[12.5px] font-bold text-[#0a0b0d]"
        >
          {tr("install.how")}
        </button>
      ) : (
        <button
          type="button"
          onClick={install}
          className="rounded-[10px] bg-[var(--lime)] px-3.5 py-1.5 text-[12.5px] font-bold text-[#0a0b0d]"
        >
          {tr("install.now")}
        </button>
      )}

      <button type="button" onClick={dismiss} className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text)]">
        {tr("install.no")}
      </button>

      {howTo && (
        <ol className="w-full list-decimal pl-4 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
          <li>{tr("install.ios1")}</li>
          <li>{tr("install.ios2")}</li>
          <li>{tr("install.ios3")}</li>
        </ol>
      )}
    </div>
  );
}
