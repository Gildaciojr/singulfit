const PAGBANK_SDK_SRC =
  "https://assets.pagseguro.com.br/checkout-sdk-js/rc/dist/browser/pagseguro.min.js";
const PAGBANK_SDK_SCRIPT_ID = "pagbank-checkout-sdk";

export type PagBankCardEncryptionInput = {
  publicKey: string;
  holderName: string;
  cardNumber: string;
  expMonth: string;
  expYear: string;
  securityCode: string;
};

type PagBankEncryptCardRequest = {
  publicKey: string;
  holder: string;
  number: string;
  expMonth: string;
  expYear: string;
  securityCode: string;
};

type PagBankEncryptionError = {
  code?: string;
  message?: string;
};

type PagBankEncryptedCardResult = {
  encryptedCard?: string;
  hasErrors: boolean;
  errors?: PagBankEncryptionError[];
};

type PagBankBrowserSdk = {
  encryptCard: (
    input: PagBankEncryptCardRequest,
  ) => PagBankEncryptedCardResult;
};

declare global {
  interface Window {
    PagSeguro?: PagBankBrowserSdk;
  }
}

let sdkPromise: Promise<PagBankBrowserSdk> | null = null;

export function loadPagBankSdk(): Promise<PagBankBrowserSdk> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(
      new Error("Ambiente seguro de pagamento indisponível."),
    );
  }

  if (window.PagSeguro) {
    return Promise.resolve(window.PagSeguro);
  }

  if (sdkPromise) {
    return sdkPromise;
  }

  sdkPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById(PAGBANK_SDK_SCRIPT_ID);

    if (existingScript) {
      existingScript.addEventListener("load", () => {
        if (window.PagSeguro) {
          resolve(window.PagSeguro);
          return;
        }

        reject(new Error("SDK PagBank carregado sem inicialização."));
      });
      existingScript.addEventListener("error", () => {
        reject(new Error("Não foi possível carregar o SDK PagBank."));
      });
      return;
    }

    const script = document.createElement("script");
    script.id = PAGBANK_SDK_SCRIPT_ID;
    script.src = PAGBANK_SDK_SRC;
    script.async = true;

    script.addEventListener("load", () => {
      if (window.PagSeguro) {
        resolve(window.PagSeguro);
        return;
      }

      reject(new Error("SDK PagBank carregado sem inicialização."));
    });
    script.addEventListener("error", () => {
      reject(new Error("Não foi possível carregar o SDK PagBank."));
    });

    document.head.appendChild(script);
  });

  return sdkPromise;
}

export function encryptPagBankCard(
  sdk: PagBankBrowserSdk,
  input: PagBankCardEncryptionInput,
): string {
  const result = sdk.encryptCard({
    publicKey: input.publicKey,
    holder: input.holderName,
    number: input.cardNumber,
    expMonth: input.expMonth,
    expYear: input.expYear,
    securityCode: input.securityCode,
  });

  if (result.hasErrors || !result.encryptedCard) {
    throw new Error("Não foi possível criptografar os dados do cartão.");
  }

  return result.encryptedCard;
}
