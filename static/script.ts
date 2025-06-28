import * as pdfjs from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";
import SignaturePad from "signature_pad";
import { PDFDocument } from "@cantoo/pdf-lib";

const SIGNATURE_WIDTH = 100;
const INITIAL_ZOOM_PERCENTAGE = 100;
const PAGES_CONTAINER_PADDING = 10;

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
const devicePixelRatio = Math.max(window.devicePixelRatio || 1, 1);

let pdfFile: File | undefined;
let pdfDoc: pdfjs.PDFDocumentProxy | undefined;

let pdfCanvases: HTMLCanvasElement[] = [];
let signaturesCanvases: HTMLCanvasElement[] = [];

type SignatureInstance = {
  id: symbol;
  img: HTMLImageElement;
  svg: string;
  x: number;
  y: number;
  scale: number;
  pageIndex: number;
  lastPressedTime: number;
};

let signatureInstances: SignatureInstance[] = [];

let selectedSignature: {
  signature: SignatureInstance;
  offset: { x: number; y: number };
  isPressed: boolean;
} | null = null;

type PointerMode = "pan" | "select";

const assertNever = (never: never) => {};

const [getPointerMode, setPointerMode] = (() => {
  let pointerMode: PointerMode = "select";

  return [
    () => pointerMode,
    (newPointerMode: PointerMode) => {
      console.log({ newPointerMode });

      if (newPointerMode === "pan") {
        selectedSignature = null;
        pagesContainer.style.touchAction = "auto";
      } else if (newPointerMode === "select") {
        pagesContainer.style.touchAction = "none";
      } else if (true) {
        assertNever(newPointerMode);
      }

      pointerMode = newPointerMode;
    },
  ];
})();

let pagesContainerRatio = 1;
let zoomPercentage = INITIAL_ZOOM_PERCENTAGE;

const signaturePadCanvas = getElementByIdOrThrow(
  "signaturePadCanvas",
  "canvas"
);
const pdfInput = getElementByIdOrThrow("pdfInput", "input");
const pdfInputButton = getElementByIdOrThrow("pdfInputButton", "button");
const pagesContainer = getElementByIdOrThrow("pagesContainer", "div");
const zoomOutButton = getElementByIdOrThrow("zoomOutButton", "button");
const zoomInButton = getElementByIdOrThrow("zoomInButton", "button");
const signButton = getElementByIdOrThrow("signButton", "button");
const signaturesModal = getElementByIdOrThrow("signaturesModal", "div");
const signaturesContainer = getElementByIdOrThrow("signaturesContainer", "div");
const newSignatureButton = getElementByIdOrThrow(
  "newSignatureButton",
  "button"
);
const signaturePadModal = getElementByIdOrThrow("signaturePadModal", "div");
const clearNewSignatureButton = getElementByIdOrThrow(
  "clearNewSignatureButton",
  "button"
);
const cancelNewSignatureButton = getElementByIdOrThrow(
  "cancelNewSignatureButton",
  "button"
);
const createNewSignatureButton = getElementByIdOrThrow(
  "createNewSignatureButton",
  "button"
);
const downloadButton = getElementByIdOrThrow("downloadButton", "button");
const panButton = getElementByIdOrThrow("panButton", "button");
const selectButton = getElementByIdOrThrow("selectButton", "button");
const cancelSignaturesModal = getElementByIdOrThrow(
  "cancelSignaturesModal",
  "button"
);

pagesContainer.style.padding = `${PAGES_CONTAINER_PADDING}px`;

// TODO: solve this shit
// @ts-ignore
const signaturePad = new SignaturePad(signaturePadCanvas);

signaturePadCanvas.style.width = `${signaturePadCanvas.width}px`;
signaturePadCanvas.style.height = `${signaturePadCanvas.height}px`;
signaturePadCanvas.width *= devicePixelRatio;
signaturePadCanvas.height *= devicePixelRatio;
const context = signaturePadCanvas.getContext("2d");
if (!context) {
  throw new Error("Wasn't able to get canvas context");
}
context.scale(devicePixelRatio, devicePixelRatio);
signaturePad.clear();

pdfInputButton.addEventListener("click", () => {
  pdfInput.click();
});

pdfInputButton.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "touch") {
    setPointerMode("pan");
  }
});

panButton.addEventListener("click", () => {
  selectedSignature = null;
  if (!pdfDoc) {
    throw new Error("This error should never happen");
  }
  render(pdfDoc);
  setPointerMode("pan");
});
selectButton.addEventListener("click", () => {
  setPointerMode("select");
});

pdfInput.addEventListener("change", async (event) => {
  pdfFile = pdfInput.files?.[0];

  if (!pdfFile) {
    alert("PDF não selecionado");
    return;
  }

  pdfInputButton.hidden = true;

  const pdfBytes = await pdfFile.arrayBuffer();
  pdfDoc = await pdfjs.getDocument({ data: pdfBytes }).promise;

  if (pdfDoc.numPages <= 0) {
    alert("O PDF selecionado está vazio");
    return;
  }

  const firstPage = await pdfDoc.getPage(1);
  const pageWidth = firstPage.getViewport({ scale: 1 }).width;
  const pagesContainerWidth = pagesContainer.getBoundingClientRect().width;

  pagesContainerRatio =
    (pagesContainerWidth - PAGES_CONTAINER_PADDING * 3) / pageWidth;

  pdfCanvases = new Array(pdfDoc.numPages);
  signaturesCanvases = new Array(pdfDoc.numPages);

  for (let index = 0; index < pdfDoc.numPages; index++) {
    const pdfCanvas = document.createElement("canvas");
    pdfCanvas.className = "pdfCanvas";

    const signaturesCanvas = document.createElement("canvas");
    signaturesCanvas.className = "signaturesCanvas";

    signaturesCanvas.addEventListener("pointerdown", async (event) => {
      if (getPointerMode() === "pan") {
        return;
      }

      selectedSignature = null;

      const canvasRatio = pagesContainerRatio * (zoomPercentage / 100);
      const clickXOnPdf = event.offsetX / canvasRatio;
      const clickYOnPdf = event.offsetY / canvasRatio;

      const signatureInstance = signatureInstances.find((signatureInstance) => {
        const { img, x: signatureX, y: signatureY, scale } = signatureInstance;
        const signatureSizeRatio = SIGNATURE_WIDTH / img.width;
        const signatureWidth = img.width * signatureSizeRatio * scale;
        const signatureHeight = img.height * signatureSizeRatio * scale;
        return (
          clickXOnPdf >= signatureX &&
          clickXOnPdf <= signatureX + signatureWidth &&
          clickYOnPdf >= signatureY &&
          clickYOnPdf <= signatureY + signatureHeight
        );
      });

      if (signatureInstance) {
        selectedSignature = {
          signature: signatureInstance,
          offset: {
            x: clickXOnPdf - signatureInstance.x,
            y: clickYOnPdf - signatureInstance.y,
          },
          isPressed: true,
        };

        selectedSignature.signature.lastPressedTime = Date.now();
      }

      if (!pdfDoc) {
        throw new Error("This error should never happen");
      }
      await render(pdfDoc);
    });

    signaturesCanvas.addEventListener("pointerup", async (event) => {
      if (getPointerMode() === "pan") {
        return;
      }

      if (selectedSignature?.isPressed) {
        selectedSignature.isPressed = false;
        signatureInstances.sort(
          (a, b) => b.lastPressedTime - a.lastPressedTime
        );
      }
    });

    signaturesCanvas.addEventListener("pointermove", async (event) => {
      if (getPointerMode() === "pan") {
        return;
      }

      if (selectedSignature?.isPressed) {
        selectedSignature.signature.pageIndex = index;

        const canvasRatio = pagesContainerRatio * (zoomPercentage / 100);
        const clickXOnPdf = event.offsetX / canvasRatio;
        const clickYOnPdf = event.offsetY / canvasRatio;

        selectedSignature.signature.x =
          clickXOnPdf - selectedSignature.offset.x;
        selectedSignature.signature.y =
          clickYOnPdf - selectedSignature.offset.y;

        if (!pdfDoc) {
          throw new Error("This error should never happen");
        }
        await render(pdfDoc);
      }
    });

    const pageContainer = document.createElement("div");
    pageContainer.className = "pageContainer";
    pageContainer.appendChild(pdfCanvas);
    pageContainer.appendChild(signaturesCanvas);

    pagesContainer.appendChild(pageContainer);

    pdfCanvases[index] = pdfCanvas;
    signaturesCanvases[index] = signaturesCanvas;
  }

  await render(pdfDoc);

  panButton.hidden = getPointerMode() === "select";
  selectButton.hidden = getPointerMode() === "select";
  zoomOutButton.hidden = false;
  zoomInButton.hidden = false;
  signButton.hidden = false;
  downloadButton.hidden = false;
});

// TODO:
// handle virtual list to only render a few pages at a time
// render only what's needed
// deal spam rendering properly and with good performance
zoomOutButton.addEventListener("click", (event) => {
  zoomPercentage = Math.max(zoomPercentage - 10, 10);

  if (!pdfDoc) {
    throw new Error("This error should never happen");
  }
  render(pdfDoc);
});

zoomInButton.addEventListener("click", (event) => {
  zoomPercentage = Math.min(zoomPercentage + 10, 1000);

  if (!pdfDoc) {
    throw new Error("This error should never happen");
  }
  render(pdfDoc);
});

signButton.addEventListener("click", (event) => {
  signaturesModal.hidden = !signaturePadModal.hidden;
});

newSignatureButton.addEventListener("click", (event) => {
  signaturePadModal.hidden = false;
  signaturesModal.hidden = true;
});

cancelSignaturesModal.addEventListener("click", (event) => {
  signaturesModal.hidden = true;
});

clearNewSignatureButton.addEventListener("click", (event) => {
  clearSignaturePad();
});

cancelNewSignatureButton.addEventListener("click", (event) => {
  signaturePadModal.hidden = true;
  clearSignaturePad();
});

function clearSignaturePad() {
  signaturePad.clear();
  clearNewSignatureButton.disabled = true;
  createNewSignatureButton.disabled = true;
}

signaturePad.addEventListener("beginStroke", () => {
  clearNewSignatureButton.disabled = false;
  createNewSignatureButton.disabled = false;
});

createNewSignatureButton.addEventListener("click", (event) => {
  const dataUrl = signaturePad.toDataURL("image/svg+xml");
  const svg = signaturePad.toSVG();

  const div = document.createElement("div");
  div.className = "signatureContainer";

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Deletar";
  button.addEventListener("click", (event) => {
    div.remove();
  });

  const img = document.createElement("img");
  img.addEventListener("load", (event) => {
    const createNewSignatureInstance = () => {
      const newSignatureInstance: SignatureInstance = {
        id: Symbol(),
        img,
        svg,
        x: 50,
        y: 50,
        scale: 1,
        pageIndex: 0,
        lastPressedTime: Date.now(),
      };
      signatureInstances.unshift(newSignatureInstance);

      selectedSignature = {
        signature: newSignatureInstance,
        isPressed: false,
        offset: {
          x: 0,
          y: 0,
        },
      };

      setPointerMode("select");

      if (!pdfDoc) {
        throw new Error("This error should never happen");
      }

      render(pdfDoc);
    };

    createNewSignatureInstance();

    img.addEventListener("click", (event) => {
      createNewSignatureInstance();
      signaturesModal.hidden = true;
    });
  });
  img.src = dataUrl;

  div.appendChild(img);
  div.appendChild(button);

  signaturesContainer.appendChild(div);

  signaturePadModal.hidden = true;
  clearSignaturePad();
});

let isRendering = false;

async function render(pdfDoc: pdfjs.PDFDocumentProxy) {
  if (isRendering) {
    return;
  }

  isRendering = true;

  const renderTimeStart = performance.now();
  let tasksDoneCount = 0;

  const pdfRenderPromises = pdfCanvases.map(async (pdfCanvas, index) => {
    const page = await pdfDoc.getPage(index + 1);

    const scale = pagesContainerRatio * (zoomPercentage / 100);
    const scaledViewport = page.getViewport({ scale });

    pdfCanvas.width = scaledViewport.width * devicePixelRatio;
    pdfCanvas.height = scaledViewport.height * devicePixelRatio;
    pdfCanvas.style.width = `${Math.floor(scaledViewport.width)}px`;
    pdfCanvas.style.height = `${Math.floor(scaledViewport.height)}px`;

    const signaturesCanvas = signaturesCanvases[index];
    if (!signaturesCanvas) {
      throw new Error("This error should never happen");
    }
    signaturesCanvas.width = scaledViewport.width * devicePixelRatio;
    signaturesCanvas.height = scaledViewport.height * devicePixelRatio;
    // TODO: I need to set the css sizes to be the same I expect to draw before scaling
    // because the canvas sizes will be ints I guess, and css accepts floats, so I should round before setting the css styles
    signaturesCanvas.style.width = `${Math.floor(scaledViewport.width)}px`;
    signaturesCanvas.style.height = `${Math.floor(scaledViewport.height)}px`;

    const canvasContext = pdfCanvas.getContext("2d");

    if (!canvasContext) {
      throw new Error("Wasn't able to get canvas context");
    }

    // TODO: I can remove this transform and just scale the viewport also using the `devicePixelRatio`
    const transform = [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0];

    await page.render({
      viewport: scaledViewport,
      canvasContext,
      transform,
    }).promise;

    tasksDoneCount++;
    if (tasksDoneCount === pdfCanvases.length) {
      console.log("PDF RENDER TIME:", performance.now() - renderTimeStart);
    }
  });

  await Promise.all(pdfRenderPromises);

  signatureInstances.forEach(drawSignatureInstance);

  isRendering = false;
}

function drawSignatureInstance(signatureInstance: SignatureInstance) {
  const { pageIndex, img, x, y, scale } = signatureInstance;

  const signatureSizeRatio = SIGNATURE_WIDTH / img.width;
  const canvasRatio =
    pagesContainerRatio * (zoomPercentage / 100) * devicePixelRatio;

  const context = signaturesCanvases[pageIndex].getContext("2d");

  if (!context) {
    throw new Error("Wasn't able to get canvas context");
  }

  context.drawImage(
    img,
    x * canvasRatio,
    y * canvasRatio,
    img.width * signatureSizeRatio * scale * canvasRatio,
    img.height * signatureSizeRatio * scale * canvasRatio
  );
  context.strokeStyle =
    signatureInstance.id === selectedSignature?.signature.id ? "red" : "blue";
  context.strokeRect(
    x * canvasRatio,
    y * canvasRatio,
    img.width * signatureSizeRatio * scale * canvasRatio,
    img.height * signatureSizeRatio * scale * canvasRatio
  );
}

downloadButton.addEventListener("click", download);

async function download() {
  if (!pdfFile) {
    throw new Error("This error should never happen");
  }

  const pdfBytes = await pdfFile.arrayBuffer();
  const pdfDocument = await PDFDocument.load(pdfBytes);

  signatureInstances.forEach((signatureInstance) => {
    const { pageIndex, img, x, y, scale } = signatureInstance;

    const signatureSizeRatio = SIGNATURE_WIDTH / img.width;

    const page = pdfDocument.getPage(pageIndex);

    page.drawSvg(signatureInstance.svg, {
      x: x,
      y: page.getHeight() - y,
      width: img.width * signatureSizeRatio * scale,
      height: img.height * signatureSizeRatio * scale,
    });
  });

  const newPdfBytes = await pdfDocument.save();
  const newPdfBlob = new Blob([newPdfBytes], { type: pdfFile.type });

  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(newPdfBlob);
  anchor.download = pdfFile.name;
  anchor.click();
}

function getElementByIdOrThrow<K extends keyof HTMLElementTagNameMap>(
  id: string,
  tag: K
): HTMLElementTagNameMap[K] {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Element with ID "${id}" not found`);
  }

  if (element.tagName.toLowerCase() !== tag) {
    throw new Error(
      `Element with ID "${id}" is not a <${tag}> (actual: <${element.tagName.toLowerCase()}>)`
    );
  }

  return element as HTMLElementTagNameMap[K];
}
