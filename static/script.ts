import * as pdfjs from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";
import SignaturePad from "signature_pad";
import { PDFDocument, toDegrees } from "@cantoo/pdf-lib";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

type SignatureInstance = {
  id: symbol;
  img: HTMLImageElement;
  pngDataUrl: string;
  x: number;
  y: number;
  scale: number;
  pageIndex: number;
  lastPressedTime: number;
};

type SelectedSignature = {
  signature: SignatureInstance;
  offset: { x: number; y: number };
  isPressed: boolean;
};

type PointerMode = "pan" | "select" | "computer";

const SIGNATURE_WIDTH = 100;
const INITIAL_ZOOM_PERCENTAGE = 100;
const PAGES_CONTAINER_PADDING = 10;
const PAGES_CONTAINER_ROW_GAP = 10;

const devicePixelRatio = Math.max(window.devicePixelRatio || 1, 1);

let pdfFile: File | null = null;
let pdfDoc: pdfjs.PDFDocumentProxy | null = null;

let pdfCanvases: HTMLCanvasElement[] = [];
let signaturesCanvases: HTMLCanvasElement[] = [];

let signatureInstances: SignatureInstance[] = [];

let pagesContainerRatio = 1;
let zoomPercentage = INITIAL_ZOOM_PERCENTAGE;

let signaturesCanvasToIndex: WeakMap<Element, number> = new WeakMap();

let pdfSize: { width: number, height: number } | null = null;

let firstVisiblePageIndex: number | null = null
let firstLoadedPageIndex: number | null = null

const [getPointerMode, setPointerMode] = (() => {
  let pointerMode: PointerMode | null = null;

  return [
    () => pointerMode,
    (newPointerMode: PointerMode) => {
      if (newPointerMode === "pan") {
        setSelectedSignature(null);
        pagesContainer.style.touchAction = "auto";
        panButton.hidden = true;
        selectButton.hidden = false;
      } else if (newPointerMode === "select") {
        pagesContainer.style.touchAction = "none";
        selectButton.hidden = true;
        panButton.hidden = false;
      } else if (newPointerMode === "computer") {
        selectButton.hidden = true;
        panButton.hidden = true;
      } else if (true) {
        assertNever(newPointerMode);
      }

      pointerMode = newPointerMode;
    },
  ];
})();

const [getSelectedSignature, setSelectedSignature] = (() => {
  let selectedSignature: SelectedSignature | null = null;

  return [
    (): SelectedSignature | null  => selectedSignature,
    (newSelectedSignature: SelectedSignature | null) => {
      const shouldHideButtons = newSelectedSignature === null;

      duplicateSignatureButton.hidden = shouldHideButtons;
      deleteSignatureButton.hidden = shouldHideButtons;
      increaseSignatureButton.hidden = shouldHideButtons;
      decreaseSignatureButton.hidden = shouldHideButtons;

      selectedSignature = newSelectedSignature;
    },
  ];
})();

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
const duplicateSignatureButton = getElementByIdOrThrow(
  "duplicateSignatureButton",
  "button"
);
const deleteSignatureButton = getElementByIdOrThrow(
  "deleteSignatureButton",
  "button"
);
const increaseSignatureButton = getElementByIdOrThrow(
  "increaseSignatureButton",
  "button"
);
const decreaseSignatureButton = getElementByIdOrThrow(
  "decreaseSignatureButton",
  "button"
);
const navbarPdf = getElementByIdOrThrow(
  "navbarPdf",
  "div"
);

const pagesViewport = getElementByIdOrThrow("pagesViewport", "div");

// TODO: improve name
let lastY = pagesViewport.scrollTop;


const signaturePadCanvas = getElementByIdOrThrow(
  "signaturePadCanvas",
  "canvas"
);

// TODO: solve this shit
// @ts-ignore
const signaturePad = new SignaturePad(signaturePadCanvas, {
  minWidth: 2,
  maxWidth: 2,
  throttle: 0,
  minDistance: 0,
});

console.log("OFFSET SIZE CANVAS");
console.log(signaturePadCanvas.offsetWidth);
console.log(signaturePadCanvas.offsetHeight);  

signaturePadCanvas.style.width = `${signaturePadCanvas.offsetWidth}px`;
signaturePadCanvas.style.height = `${signaturePadCanvas.offsetHeight}px`;
signaturePadCanvas.width = signaturePadCanvas.offsetWidth * devicePixelRatio;
signaturePadCanvas.height = signaturePadCanvas.offsetHeight * devicePixelRatio;

signaturePadModal.hidden = true;
signaturePadModal.classList.remove("offScreen");

const context = signaturePadCanvas.getContext("2d");
if (context == null) {
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
  } else {
    setPointerMode("computer");
  }
});

panButton.addEventListener("click", () => {
  setSelectedSignature(null);
  if (pdfDoc == null) {
    throw new Error("This error should never happen");
  }
  render(pdfDoc);
  setPointerMode("pan");
});
selectButton.addEventListener("click", () => {
  setPointerMode("select");
});

let ignoreNextScroll = false;

pagesViewport.addEventListener('scroll', () => {
  if (ignoreNextScroll) {
    ignoreNextScroll = false;
    return;
  }

  const currentY = pagesViewport.scrollTop;
  if (currentY === lastY) {
    return
  }

  lastY = currentY
  afterSizeChanges()
}
)


pdfInput.addEventListener("change", async (event) => {
  pdfFile = pdfInput.files?.[0] ?? null;

  if (pdfFile == null) {
    alert("PDF não selecionado");
    return;
  }

  pdfInputButton.hidden = true;

  const pdfBytes = await pdfFile.arrayBuffer();
  // TODO: catch exception in case the file is not really a pdf
  pdfDoc = await pdfjs.getDocument({ data: pdfBytes }).promise;

  if (pdfDoc.numPages <= 0) {
    alert("O PDF selecionado está vazio");
    return;
  }

  // TODO: i'm assuming all pages have the same width and height as the first page
  const firstPage = await pdfDoc.getPage(1);
  const { width, height } = firstPage.getViewport({ scale: 1 });
  pdfSize = {
    width,
    height,
  };

  afterSizeChanges()

  pagesContainer.addEventListener("pointerdown", pagesContainerPointerDown);
  pagesContainer.addEventListener("pointermove", pagesContainerPointerMove);
  pagesContainer.addEventListener("pointerup", pagesContainerPointerUp);
  
  navbarPdf.classList.remove("hidden");
});

// TODO:
// handle virtual list to only render a few pages at a time
// render only what's needed
// deal spam rendering properly and with good performance
zoomOutButton.addEventListener("click", (event) => {
  zoomPercentage = Math.max(zoomPercentage - 10, 10);

  afterSizeChanges()

});

zoomInButton.addEventListener("click", (event) => {
  zoomPercentage = Math.min(zoomPercentage + 10, 200);



  afterSizeChanges()
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

clearNewSignatureButton.addEventListener("pointerup", (event) => {
  clearSignaturePad();
});

cancelNewSignatureButton.addEventListener("pointerup", (event) => {
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

createNewSignatureButton.addEventListener("pointerup", (event) => {
  const dataUrl = signaturePad.toDataURL("image/svg+xml");
  const pngDataUrl = signaturePad.toDataURL();

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
        x: 50, // TODO: needs to be in the viewport
        y: 50, // TODO: needs to be in the viewport
        scale: 1,
        pageIndex: 0, // TODO: needs to be the current page
        lastPressedTime: Date.now(),
        pngDataUrl,
      };
      signatureInstances.unshift(newSignatureInstance);

      setSelectedSignature({
        signature: newSignatureInstance,
        isPressed: false,
        offset: {
          x: 0,
          y: 0,
        },
      });

      if (getPointerMode() !== "computer") {
        setPointerMode("select");
      }

      if (pdfDoc == null) {
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

// TODO: is this more blurry?
async function render(pdfDoc: pdfjs.PDFDocumentProxy) {


  if (isRendering) {
    return;
  }

  isRendering = true;

  const renderTimeStart = performance.now();
  let tasksDoneCount = 0;

  const pdfRenderPromises = pdfCanvases.map(async (pdfCanvas, index) => {
    if (firstLoadedPageIndex == null) {
      return
    }

    const page = await pdfDoc.getPage(firstLoadedPageIndex + index + 1);

    const scale = pagesContainerRatio * (zoomPercentage / 100);
    const scaledViewport = page.getViewport({ scale });

    pdfCanvas.width = scaledViewport.width * devicePixelRatio;
    pdfCanvas.height = scaledViewport.height * devicePixelRatio;
    pdfCanvas.style.width = `${Math.floor(scaledViewport.width)}px`;
    pdfCanvas.style.height = `${Math.floor(scaledViewport.height)}px`;

    const signaturesCanvas = signaturesCanvases[index];
    if (signaturesCanvas == null) {
      throw new Error("This error should never happen");
    }
    signaturesCanvas.width = scaledViewport.width * devicePixelRatio;
    signaturesCanvas.height = scaledViewport.height * devicePixelRatio;
    // TODO: I need to set the css sizes to be the same I expect to draw before scaling
    // because the canvas sizes will be ints I guess, and css accepts floats, so I should round before setting the css styles
    signaturesCanvas.style.width = `${Math.floor(scaledViewport.width)}px`;
    signaturesCanvas.style.height = `${Math.floor(scaledViewport.height)}px`;

    const canvasContext = pdfCanvas.getContext("2d");

    if (canvasContext == null) {
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

  signatureInstances.reduceRight((_, signature) => {
    drawSignatureInstance(signature);
    return null;
  }, null);

  isRendering = false;
}


function renderSignaturePage(canvasIndex: number) {
  signatureInstances.forEach((signature) => {
    if (signature.pageIndex === canvasIndex) {
      drawSignatureInstance(signature)
    }
  })
}

// list of actions that can cause a re-render and what should re-render

// create signature -> draw just that one signature
// delete signature -> draw signature page
// move signature in page -> draw signature page
// resize signature -> draw signature page
// select signature -> draw signature page
// deselect signature -> draw signature page
// move signature across pages -> draw signature in both pages

// zoom -> render everything

// scroll -> render only if firstVisiblePageIndex change

// select pdf -> render everything

// resize window -> render everything

// change orientation -> render everything


// TODO: this should run on resize, zoom, scroll, pdf change
function afterSizeChanges() {
  if (isRendering) {
    return
  }

  if (pdfDoc == null || pdfSize == null) {
    return;
  }

  // Gets the size of the screen
  const { width: pagesViewportWidth, height: pagesViewportHeight } =
    pagesViewport.getBoundingClientRect();

  // Gets the ratio that the pdf page needs to be multiplied by
  // in order to fill the screen minus de padding considering a 100% zoom 
  pagesContainerRatio =
    (pagesViewportWidth - PAGES_CONTAINER_PADDING * 2) / pdfSize.width;

  // Gets the height of the pdf on screen
  const pdfHeightOnScreen =
    pdfSize.height * pagesContainerRatio * (zoomPercentage / 100);

  const pdfWidthOnScreen =
    pdfSize.width * pagesContainerRatio * (zoomPercentage / 100);

  // Gets the total height of all pdf pages on screen, considering padding and row gaps
  const pagesContainerHeight =
    PAGES_CONTAINER_PADDING * 2 +
    pdfHeightOnScreen * pdfDoc.numPages +
    PAGES_CONTAINER_ROW_GAP * (pdfDoc.numPages - 1);

  const pagesContainerWidth = PAGES_CONTAINER_PADDING * 2 + pdfWidthOnScreen;

  const currentScrollTop = pagesViewport.scrollTop;
  const currentScrollRange = parseFloat(pagesContainer.style.height) - pagesViewport.clientHeight;
  const scrollPercent = currentScrollRange > 0 ? currentScrollTop / currentScrollRange : 0; 

  console.log("currentScrollTop", currentScrollTop);
  console.log("currentScrollRange", currentScrollRange);
  console.log("scrollPercent", scrollPercent);
  

  // Sets the pages container to its total height 
  pagesContainer.style.height = `${pagesContainerHeight}px`;
  pagesContainer.style.width = `${pagesContainerWidth}px`;

  const newScrollRange = pagesContainerHeight - pagesViewport.clientHeight;
  const newScrollTop = newScrollRange * scrollPercent;

  console.log("newScrollRange", newScrollRange);
  console.log("newScrollTop", newScrollTop);


  ignoreNextScroll = true;
  // TODO: should this be later in the code?
  // TODO: this should probably wait for the browser to render all the layout
  pagesViewport.scrollTop = newScrollTop;


  // Gets the height a row (pdf page + row gap) will have on screen 
  const rowHeight = pdfHeightOnScreen + PAGES_CONTAINER_ROW_GAP;

  // Gets the amount of pages that will appear on screen at a given time
  const maxVisiblePagesCount = Math.ceil(pagesViewportHeight / rowHeight)

  // Gets the inclusive 0 based index of the first pdf page that will be on screen
  firstVisiblePageIndex = Math.floor(
    Math.max(newScrollTop - PAGES_CONTAINER_PADDING, 0) / rowHeight
  );

  firstLoadedPageIndex = Math.max(0, firstVisiblePageIndex - maxVisiblePagesCount)
  const lastLoadedPageIndex = Math.min(pdfDoc.numPages, firstVisiblePageIndex + (maxVisiblePagesCount * 2))

  const loadedPagesCount = lastLoadedPageIndex - firstLoadedPageIndex


  console.log({ newScrollTop });
  console.log({ firstVisiblePageIndex });
  console.log({ firstLoadedPageIndex });
  console.log({ lastLoadedPageIndex });
  console.log({ loadedPagesCount });

  pdfCanvases = new Array(loadedPagesCount);
  signaturesCanvases = new Array(loadedPagesCount);

  pagesContainer.replaceChildren();
  signaturesCanvasToIndex = new WeakMap();


  for (let index = 0; index < loadedPagesCount; index++) {
    const pdfCanvas = document.createElement("canvas");
    pdfCanvas.className = "pdfCanvas";

    // TODO: maybe this math is wrong, maybe I should try to use the pdfOnScreen height instead of rowHeight
    pdfCanvas.style.top = `${PAGES_CONTAINER_PADDING + (firstLoadedPageIndex + index) * (rowHeight)}px`;

    const signaturesCanvas = document.createElement("canvas");
    signaturesCanvas.className = "signaturesCanvas";
    signaturesCanvas.style.top = `${PAGES_CONTAINER_PADDING + (firstLoadedPageIndex + index) * (rowHeight)}px`;


    signaturesCanvasToIndex.set(signaturesCanvas, index);

    pagesContainer.appendChild(pdfCanvas);
    pagesContainer.appendChild(signaturesCanvas);


    pdfCanvases[index] = pdfCanvas;
    signaturesCanvases[index] = signaturesCanvas;
  }

  render(pdfDoc);


}

function drawSignatureInstance(signatureInstance: SignatureInstance) {
  const { pageIndex, img, x, y, scale } = signatureInstance;

  const signatureSizeRatio = SIGNATURE_WIDTH / img.width;
  const canvasRatio =
    pagesContainerRatio * (zoomPercentage / 100) * devicePixelRatio;

  const canvas = signaturesCanvases[pageIndex]

  if (canvas == null) {
    throw new Error();
  }

  const context = canvas.getContext("2d");

  if (context == null) {
    throw new Error("Wasn't able to get canvas context");
  }

  context.drawImage(
    img,
    x * canvasRatio,
    y * canvasRatio,
    img.width * signatureSizeRatio * scale * canvasRatio,
    img.height * signatureSizeRatio * scale * canvasRatio
  );

  if (signatureInstance.id === getSelectedSignature()?.signature.id) {
    context.strokeStyle = "blue";
    context.strokeRect(
      x * canvasRatio,
      y * canvasRatio,
      img.width * signatureSizeRatio * scale * canvasRatio,
      img.height * signatureSizeRatio * scale * canvasRatio
    );
  }
}

downloadButton.addEventListener("click", download);

async function download() {
  if (pdfFile == null) {
    throw new Error("This error should never happen");
  }

  const pdfBytes = await pdfFile.arrayBuffer();
  const pdfDocument = await PDFDocument.load(pdfBytes);

  signatureInstances.forEach(async (signatureInstance) => {
    const { pageIndex, img, x, y, scale } = signatureInstance;

    const signatureSizeRatio = SIGNATURE_WIDTH / img.width;

    const page = pdfDocument.getPage(pageIndex);

    const pngImage = await pdfDocument.embedPng(signatureInstance.pngDataUrl)

    const pageRotationInDegrees = toDegrees(page.getRotation())

    const drawWidth = img.width * signatureSizeRatio * scale;
    const drawHeight = img.height * signatureSizeRatio * scale;

    const drawPosition = {
      0: {
        x: x,
        y: page.getHeight() - y - drawHeight,
      },
      90: {
        x: drawHeight + y,  
        y: x,
      },
    }[pageRotationInDegrees]

    if (drawPosition == null) {
      alert("Angulo da pagina não suportado");
      return;
    }

    page.drawImage(pngImage, {
      x: drawPosition.x,
      y: drawPosition.y,
      width: drawWidth,
      height: drawHeight,
      rotate: page.getRotation(),
    });
  });

  const newPdfBytes = await pdfDocument.save();
  const newPdfBlob = new Blob([newPdfBytes], { type: pdfFile.type });

  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(newPdfBlob);
  anchor.download = pdfFile.name;
  anchor.click();
}

async function pagesContainerPointerDown(event: PointerEvent) {

  if (getPointerMode() === "pan") {
    return;
  }

  const element = document.elementFromPoint(event.clientX, event.clientY);

  if (element == null) {
    return;
  }

  const index = signaturesCanvasToIndex.get(element);

  if (index == null) {
    return;
  }

  setSelectedSignature(null);

  const canvasRatio = pagesContainerRatio * (zoomPercentage / 100);

  const rect = element.getBoundingClientRect();
  const offsetX = event.clientX - rect.left;
  const offsetY = event.clientY - rect.top;

  const clickXOnPdf = offsetX / canvasRatio;
  const clickYOnPdf = offsetY / canvasRatio;

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
    setSelectedSignature({
      signature: signatureInstance,
      offset: {
        x: clickXOnPdf - signatureInstance.x,
        y: clickYOnPdf - signatureInstance.y,
      },
      isPressed: true,
    });

    const selectedSignature = getSelectedSignature();

    if (selectedSignature) {
      selectedSignature.signature.lastPressedTime = Date.now();
    }
  }

  if (pdfDoc == null) {
    throw new Error("This error should never happen");
  }
  await render(pdfDoc);


}
async function pagesContainerPointerMove(event: PointerEvent) {

  if (getPointerMode() === "pan") {
    return;
  }

  const element = document.elementFromPoint(event.clientX, event.clientY);

  if (element == null) {
    return;
  }

  const index = signaturesCanvasToIndex.get(element);

  if (index == null) {
    return;
  }

  const selectedSignature = getSelectedSignature();

  if (selectedSignature?.isPressed) {
    selectedSignature.signature.pageIndex = index;

    const canvasRatio = pagesContainerRatio * (zoomPercentage / 100);

    const rect = element.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;

    const clickXOnPdf = offsetX / canvasRatio;
    const clickYOnPdf = offsetY / canvasRatio;

    selectedSignature.signature.x = clickXOnPdf - selectedSignature.offset.x;
    selectedSignature.signature.y = clickYOnPdf - selectedSignature.offset.y;

    if (pdfDoc == null) {
      throw new Error("This error should never happen");
    }
    await render(pdfDoc);
  }
}
async function pagesContainerPointerUp(event: PointerEvent) {

  if (getPointerMode() === "pan") {
    return;
  }

  const selectedSignature = getSelectedSignature();

  if (selectedSignature?.isPressed) {
    selectedSignature.isPressed = false;
    signatureInstances.sort((a, b) => b.lastPressedTime - a.lastPressedTime);
  }

}

duplicateSignatureButton.addEventListener("click", () => {
  const selectedSignature = getSelectedSignature();

  if (selectedSignature) {
    const newSignature: SignatureInstance = {
      id: Symbol(),
      img: selectedSignature.signature.img,
      lastPressedTime: Date.now(),
      pageIndex: selectedSignature.signature.pageIndex,
      scale: selectedSignature.signature.scale,
      x: selectedSignature.signature.x,
      y: selectedSignature.signature.y + 10,
      pngDataUrl: selectedSignature.signature.pngDataUrl,
    };
    signatureInstances.unshift(newSignature);
    selectedSignature.signature = newSignature;

    if (pdfDoc == null) {
      throw new Error("pdfDoc");
    }

    render(pdfDoc);
  }
});
deleteSignatureButton.addEventListener("click", () => {
  const selectedSignature = getSelectedSignature();

  if (selectedSignature) {
    signatureInstances = signatureInstances.filter(
      (signature) => signature.id !== selectedSignature?.signature.id
    );
    setSelectedSignature(null);

    if (pdfDoc == null) {
      throw new Error("pdfDoc");
    }

    render(pdfDoc);
  }
});
increaseSignatureButton.addEventListener("click", () => {
  const selectedSignature = getSelectedSignature();

  if (selectedSignature) {
    selectedSignature.signature.scale = Math.min(
      selectedSignature.signature.scale * 1.1,
      10
    );

    if (pdfDoc == null) {
      throw new Error("pdfDoc");
    }

    render(pdfDoc);
  }
});
decreaseSignatureButton.addEventListener("click", () => {
  const selectedSignature = getSelectedSignature();

  if (selectedSignature) {
    selectedSignature.signature.scale = Math.max(
      selectedSignature.signature.scale * 0.9,
      0.1
    );

    if (pdfDoc == null) {
      throw new Error("pdfDoc");
    }

    render(pdfDoc);
  }
});

function getElementByIdOrThrow<K extends keyof HTMLElementTagNameMap>(
  id: string,
  tag: K
): HTMLElementTagNameMap[K] {
  const element = document.getElementById(id);
  if (element == null) {
    throw new Error(`Element with ID "${id}" not found`);
  }

  if (element.tagName.toLowerCase() !== tag) {
    throw new Error(
      `Element with ID "${id}" is not a <${tag}> (actual: <${element.tagName.toLowerCase()}>)`
    );
  }

  return element as HTMLElementTagNameMap[K];
}

function assertNever(_: never) { }
