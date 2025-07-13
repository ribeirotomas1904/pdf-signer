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

let signaturesCanvasToPageIndex: WeakMap<Element, number> = new WeakMap();

let pdfSize: { width: number, height: number } | null = null;

let firstLoadedPageIndex: number | null = null
let firstVisiblePageIndex: number | null = null
let lastLoadedPageIndex: number | null = null

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
  const pageIndex = getSelectedSignature()?.signature.pageIndex;
  setPointerMode("pan");

  if (pageIndex == null) {
    return;
  }

  if (pdfDoc == null) {
    throw new Error("This error should never happen");
  }

  const canvas = signaturesCanvases.find((canvas) => {
    return signaturesCanvasToPageIndex.get(canvas) === pageIndex;
  });

  if (canvas == null || pageIndex < 0 || pageIndex >= pdfDoc.numPages) {
    return;
  }

  renderSignaturesPage(pageIndex, canvas.getContext('2d'))
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
    return;
  }

  lastY = currentY;
  onScroll();
});

type AutoScrollState = 
{
  tag: "scrolling",
  scrollDelta: {
    x: number,
    y: number,
  }
  clientX: number,
  clientY: number,
}
|
{
  tag: "idle"
};

const BORDER_THRESHOLD = 80;

let autoScrollState: AutoScrollState = {
  tag: "idle",
};

// TODO: when scrolling it should also update the selected signature position and page
const autoScroll = (()=>{
  let isAutoScrolling = false; 

  return () => {
    if (isAutoScrolling) {
      return;
    }

    const loop = () => {
      if (autoScrollState.tag === "idle") {
        isAutoScrolling = false;
        return;
      }

      isAutoScrolling = true;
  
      pagesViewport.scrollLeft += autoScrollState.scrollDelta.x;
      pagesViewport.scrollTop += autoScrollState.scrollDelta.y;

      const moveEvent = new PointerEvent('pointermove', {
        clientX: autoScrollState.clientX,
        clientY: autoScrollState.clientY,
      });

      pagesContainer.dispatchEvent(moveEvent);
      
      requestAnimationFrame(loop);
    }

    loop()
  };
})();

pagesViewport.addEventListener('pointermove', (event) => {
  if (!getSelectedSignature()?.isPressed) {
    autoScrollState = {
      tag: "idle",
    };

    return;
  }

  const rect = pagesViewport.getBoundingClientRect();
  const nearLeft = event.clientX - rect.left < BORDER_THRESHOLD;
  const nearRight = rect.right - event.clientX < BORDER_THRESHOLD;
  const nearTop = event.clientY - rect.top < BORDER_THRESHOLD;
  const nearBottom = rect.bottom - event.clientY < BORDER_THRESHOLD;

  if (!nearLeft && !nearRight && !nearTop && !nearBottom) {
    autoScrollState = {
      tag: "idle",
    };

    return;
  }

  const deltaX = 
    nearLeft ?
       -10 :
       (nearRight ?
        10 :
        0
       )

  const deltaY = 
    nearTop ?
       -10 :
       (nearBottom ?
        10 :
        0
       )
 
  autoScrollState = {
    tag: "scrolling",
    scrollDelta: {
      x: deltaX,
      y: deltaY,
    },
    clientX: event.clientX,
    clientY: event.clientY,
  };
  
  autoScroll();
 
});

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

zoomOutButton.addEventListener("click", (event) => {
  zoomPercentage = Math.max(zoomPercentage - 10, 10);

  afterSizeChanges()
});

zoomInButton.addEventListener("click", (event) => {
  zoomPercentage = Math.min(zoomPercentage + 10, 300);

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

  const createNewSignatureInstance = (pageIndex: number) => {
    const newSignatureInstance: SignatureInstance = {
      id: Symbol(),
      img,
      x: 50, // TODO: needs to be in the viewport
      y: 50, // TODO: needs to be in the viewport
      scale: 1,
      pageIndex,
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

    const canvas = signaturesCanvases.find((canvas) => {
      return signaturesCanvasToPageIndex.get(canvas) === pageIndex;
    });

    if (canvas == null || pageIndex < 0 || pageIndex >= pdfDoc.numPages) {
      return;
    }

    renderSignaturesPage(pageIndex, canvas.getContext('2d'));
  };

  const pageIndex = firstVisiblePageIndex ?? 0;

  img.addEventListener("load", () => {
    createNewSignatureInstance(pageIndex);
  
    img.addEventListener("click", () => {
      createNewSignatureInstance(firstVisiblePageIndex ?? 0);
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
  
  if (firstLoadedPageIndex == null || lastLoadedPageIndex == null) {
    return;
  }

  const renderTimeStart = performance.now();

  const pdfRenderPromises = pdfCanvases.map(async (pdfCanvas, indexTEMP) => {
    const pageIndex = signaturesCanvasToPageIndex.get(signaturesCanvases[indexTEMP])

    if (pageIndex == null || pageIndex < 0 || pageIndex >= pdfDoc.numPages) {
      return;
    }

    const page = await pdfDoc.getPage(pageIndex + 1);

    const canvasContext = pdfCanvas.getContext("2d");

    if (canvasContext == null) {
      throw new Error("Wasn't able to get canvas context");
    }

    renderPdfPage(page, canvasContext)
  });
  
  signaturesCanvases.forEach((canvas) => {
    const pageIndex = signaturesCanvasToPageIndex.get(canvas)

    if (pageIndex == null || pageIndex < 0 || pageIndex >= pdfDoc.numPages) {
      return;
    }

    const canvasContext = canvas.getContext('2d');
    
    if (canvasContext == null) {
      return;
    }
    
    renderSignaturesPage(pageIndex, canvasContext);
  });
  
  await Promise.all(pdfRenderPromises);
  
  isRendering = false;
  console.log("PDF RENDER TIME:", performance.now() - renderTimeStart);
}

async function renderPdfPage(pdfPage: pdfjs.PDFPageProxy, canvasContext: CanvasRenderingContext2D) {
  const renderStartTime = performance.now();  

  const scale = pagesContainerRatio * (zoomPercentage / 100) * devicePixelRatio;
  const viewport = pdfPage.getViewport({ scale });
  
  canvasContext.clearRect(0, 0, canvasContext.canvas.width, canvasContext.canvas.height)
  
  await pdfPage.render({
    viewport,
    canvasContext,
  }).promise;

  console.log(`RENDERED PDF PAGE INDEX ${pdfPage.pageNumber - 1} IN ${performance.now() - renderStartTime}ms`);
}

function renderSignaturesPage(pageIndex: number, canvasContext: CanvasRenderingContext2D) {
  const renderStartTime = performance.now();

  canvasContext.clearRect(0, 0, canvasContext.canvas.width, canvasContext.canvas.height)

  signatureInstances.slice().reverse().forEach((signature) => {
    if (signature.pageIndex === pageIndex) {
      renderSignatureInstance(signature, canvasContext);
    }
  })

  console.log(`RENDERED SIGNATURES PAGE INDEX ${pageIndex} IN ${performance.now() - renderStartTime}ms`);
}

function renderSignatureInstance(signatureInstance: SignatureInstance, canvasContext: CanvasRenderingContext2D) {
  const { img, x, y, scale } = signatureInstance;

  const signatureSizeRatio = SIGNATURE_WIDTH / img.width;
  const canvasRatio =
    pagesContainerRatio * (zoomPercentage / 100) * devicePixelRatio;

  canvasContext.drawImage(
    img,
    x * canvasRatio,
    y * canvasRatio,
    img.width * signatureSizeRatio * scale * canvasRatio,
    img.height * signatureSizeRatio * scale * canvasRatio
  );

  if (signatureInstance.id === getSelectedSignature()?.signature.id) {
    canvasContext.strokeStyle = "blue";
    canvasContext.strokeRect(
      x * canvasRatio,
      y * canvasRatio,
      img.width * signatureSizeRatio * scale * canvasRatio,
      img.height * signatureSizeRatio * scale * canvasRatio
    );
  }
}

async function onScroll() {  

  if (pdfDoc == null || pdfSize == null) {
    return;
  }

  if (isRendering) {
    return;
  }

  if (firstLoadedPageIndex == null) {
    return;
  }

  const pagesViewportHeight = pagesViewport.getBoundingClientRect().height;
  const pdfHeightOnScreen = pdfSize.height * pagesContainerRatio * (zoomPercentage / 100);
  const rowHeight = pdfHeightOnScreen + PAGES_CONTAINER_ROW_GAP;
  const maxVisiblePagesCount = Math.ceil(pagesViewportHeight / rowHeight)

  const newFirstVisiblePageIndex = Math.floor(
    Math.max(pagesViewport.scrollTop - PAGES_CONTAINER_PADDING, 0) / rowHeight
  );

  const newFirstLoadedPageIndex = newFirstVisiblePageIndex - maxVisiblePagesCount;
  const newLastLoadedPageIndex = newFirstVisiblePageIndex + (maxVisiblePagesCount * 2);

  const loadedPagesCount = maxVisiblePagesCount * 3;

  const distance = newFirstLoadedPageIndex - firstLoadedPageIndex;

  if (distance === 0) {
    return;
  }

  let rotation = Math.abs(distance) > loadedPagesCount ? loadedPagesCount : distance;

  if (rotation > 0) {
    while (rotation > 0) {
      const pdfCanvas = pdfCanvases.shift()
      const signaturesCanvas = signaturesCanvases.shift()

      if (pdfCanvas && signaturesCanvas) {
        pdfCanvases.push(pdfCanvas); 
        signaturesCanvases.push(signaturesCanvas); 
      }
      rotation--;
    }
  } else {
    while (rotation < 0) {
      const pdfCanvas = pdfCanvases.pop()
      const signaturesCanvas = signaturesCanvases.pop()

      if (pdfCanvas && signaturesCanvas) {        
        pdfCanvases.unshift(pdfCanvas); 
        signaturesCanvases.unshift(signaturesCanvas); 
      }
      rotation++;
    }
  }

  for (let index = 0; index < loadedPagesCount; index++) {
    const pageIndex = newFirstLoadedPageIndex + index;
    const pdfCanvas = pdfCanvases[index];
    const signaturesCanvas = signaturesCanvases[index];

    if (!pdfCanvas || !signaturesCanvas) {
      continue
    };

    if (signaturesCanvasToPageIndex.get(signaturesCanvas) !== pageIndex && pageIndex >= 0 && pageIndex < pdfDoc.numPages) {
      const page = await pdfDoc.getPage(pageIndex + 1);
      renderPdfPage(page, pdfCanvas.getContext('2d'));
      renderSignaturesPage(pageIndex, signaturesCanvas.getContext('2d'));
    }

    const top = `${PAGES_CONTAINER_PADDING + pageIndex * rowHeight}px`;

    if (pdfCanvas.style.top !== top) {
      pdfCanvas.style.top = top;
      signaturesCanvas.style.top = top;
    }

    signaturesCanvasToPageIndex.set(signaturesCanvas, pageIndex);
  }

  firstLoadedPageIndex = newFirstLoadedPageIndex;
  firstVisiblePageIndex = newFirstVisiblePageIndex;
  lastLoadedPageIndex = newLastLoadedPageIndex;
}

// TODO: this should run on resize, zoom, scroll, pdf change
// NOW: what can I remove from here and just call another function that already does the job?
function afterSizeChanges() {
  if (isRendering) {
    return
  }

  if (pdfDoc == null || pdfSize == null) {
    return;
  }

  const { width: pagesViewportWidth, height: pagesViewportHeight } =
    pagesViewport.getBoundingClientRect();

  pagesContainerRatio =
    (pagesViewportWidth - PAGES_CONTAINER_PADDING * 2) / pdfSize.width;

  const pdfHeightOnScreen =
    pdfSize.height * pagesContainerRatio * (zoomPercentage / 100);

  const pdfWidthOnScreen =
    pdfSize.width * pagesContainerRatio * (zoomPercentage / 100);

  const pagesContainerHeight =
    PAGES_CONTAINER_PADDING * 2 +
    pdfHeightOnScreen * pdfDoc.numPages +
    PAGES_CONTAINER_ROW_GAP * (pdfDoc.numPages - 1);

  const pagesContainerWidth = PAGES_CONTAINER_PADDING * 2 + pdfWidthOnScreen;

  const currentScrollTop = pagesViewport.scrollTop;
  const currentScrollRange = parseFloat(pagesContainer.style.height) - pagesViewport.clientHeight;
  const scrollPercent = currentScrollRange > 0 ? currentScrollTop / currentScrollRange : 0; 

  pagesContainer.style.height = `${pagesContainerHeight}px`;
  pagesContainer.style.width = `${pagesContainerWidth}px`;

  const newScrollRange = pagesContainerHeight - pagesViewport.clientHeight;
  const newScrollTop = newScrollRange * scrollPercent;

  ignoreNextScroll = true;
  // TODO: should this be later in the code?
  // TODO: this should probably wait for the browser to render all the layout
  pagesViewport.scrollTop = newScrollTop;


  const rowHeight = pdfHeightOnScreen + PAGES_CONTAINER_ROW_GAP;

  const maxVisiblePagesCount = Math.ceil(pagesViewportHeight / rowHeight)

  firstVisiblePageIndex = Math.floor(
    Math.max(newScrollTop - PAGES_CONTAINER_PADDING, 0) / rowHeight
  );

  firstLoadedPageIndex = firstVisiblePageIndex - maxVisiblePagesCount;
  lastLoadedPageIndex = pdfDoc.numPages, firstVisiblePageIndex + (maxVisiblePagesCount * 2);

  const loadedPagesCount = maxVisiblePagesCount * 3;

  pdfCanvases = new Array(loadedPagesCount);
  signaturesCanvases = new Array(loadedPagesCount);

  pagesContainer.replaceChildren();
  signaturesCanvasToPageIndex = new WeakMap();


  for (let index = 0; index < loadedPagesCount; index++) {
    const pdfCanvas = document.createElement("canvas");
    pdfCanvas.className = "pdfCanvas";

    // TODO: maybe this math is wrong, maybe I should try to use the pdfOnScreen height instead of rowHeight
    pdfCanvas.style.top = `${PAGES_CONTAINER_PADDING + (firstLoadedPageIndex + index) * (rowHeight)}px`;

    const signaturesCanvas = document.createElement("canvas");
    signaturesCanvas.className = "signaturesCanvas";
    signaturesCanvas.style.top = `${PAGES_CONTAINER_PADDING + (firstLoadedPageIndex + index) * (rowHeight)}px`;


    signaturesCanvasToPageIndex.set(signaturesCanvas, firstLoadedPageIndex + index);
    
    pdfCanvas.width = pdfWidthOnScreen * devicePixelRatio;
    pdfCanvas.height = pdfHeightOnScreen * devicePixelRatio;

    signaturesCanvas.width = pdfWidthOnScreen * devicePixelRatio;
    signaturesCanvas.height = pdfHeightOnScreen * devicePixelRatio;
    
    // TODO: I need to set the css sizes to be the same I expect to draw before scaling
    // because the canvas sizes will be ints I guess, and css accepts floats, so I should round before setting the css styles
    pdfCanvas.style.width = `${Math.floor(pdfWidthOnScreen)}px`;
    pdfCanvas.style.height = `${Math.floor(pdfHeightOnScreen)}px`;
    
    signaturesCanvas.style.width = `${Math.floor(pdfWidthOnScreen)}px`;
    signaturesCanvas.style.height = `${Math.floor(pdfHeightOnScreen)}px`;

    pagesContainer.appendChild(pdfCanvas);
    pagesContainer.appendChild(signaturesCanvas);


    pdfCanvases[index] = pdfCanvas;
    signaturesCanvases[index] = signaturesCanvas;
  }

  render(pdfDoc);
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

  const index = signaturesCanvasToPageIndex.get(element);

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
    const { img, x: signatureX, y: signatureY, scale, pageIndex } = signatureInstance;
    const signatureSizeRatio = SIGNATURE_WIDTH / img.width;
    const signatureWidth = img.width * signatureSizeRatio * scale;
    const signatureHeight = img.height * signatureSizeRatio * scale;
    return (
      pageIndex === index &&
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

    const moveEvent = new PointerEvent("pointermove", {
      clientX: event.clientX,
      clientY: event.clientY,
    });

    pagesViewport.dispatchEvent(moveEvent);

    // NOW: this should start auto scroll too
  }

  if (pdfDoc == null) {
    throw new Error("This error should never happen");
  }

  if (index < 0 || index >= pdfDoc.numPages) {
    return;
  }

  // TODO: I should not only re-render the page that I clicked, but also the one that had the selected signature
  renderSignaturesPage(index, element.getContext('2d'))
}
async function pagesContainerPointerMove(event: PointerEvent) {

  if (getPointerMode() === "pan") {
    return;
  }

  const element = document.elementFromPoint(event.clientX, event.clientY);

  if (element == null) {
    return;
  }

  const pageIndex = signaturesCanvasToPageIndex.get(element);

  if (pageIndex == null) {
    return;
  }

  const selectedSignature = getSelectedSignature();

  if (selectedSignature?.isPressed) {

    const canvasRatio = pagesContainerRatio * (zoomPercentage / 100);

    const rect = element.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;

    const clickXOnPdf = offsetX / canvasRatio;
    const clickYOnPdf = offsetY / canvasRatio;

    selectedSignature.signature.x = clickXOnPdf - selectedSignature.offset.x;
    selectedSignature.signature.y = clickYOnPdf - selectedSignature.offset.y;

    const oldPageIndex = selectedSignature.signature.pageIndex; 
    selectedSignature.signature.pageIndex = pageIndex;

    if (pdfDoc == null) {
      throw new Error("This error should never happen");
    }

    const canvas = signaturesCanvases.find((canvas) => {
      return signaturesCanvasToPageIndex.get(canvas) === pageIndex;
    });

    if (canvas == null || pageIndex < 0 || pageIndex >= pdfDoc.numPages) {
      return;
    }

    renderSignaturesPage(pageIndex, canvas.getContext('2d'));
    
    if (oldPageIndex !== pageIndex) {
      const canvas = signaturesCanvases.find((canvas) => {
        return signaturesCanvasToPageIndex.get(canvas) === oldPageIndex;
      });

      if (canvas == null || oldPageIndex < 0 || oldPageIndex >= pdfDoc.numPages) {
        return;
      }

      renderSignaturesPage(oldPageIndex, canvas.getContext('2d'));
    }
  }
}
async function pagesContainerPointerUp(event: PointerEvent) {

  if (getPointerMode() === "pan") {
    return;
  }

  const selectedSignature = getSelectedSignature();

  if (selectedSignature?.isPressed) {
    autoScrollState = { tag: "idle" };

    const moveEvent = new PointerEvent('pointermove', {
      clientX: event.clientX,
      clientY: event.clientY,
    });

    pagesContainer.dispatchEvent(moveEvent);

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

    const canvas = signaturesCanvases.find((canvas) => {
      return signaturesCanvasToPageIndex.get(canvas) === selectedSignature.signature.pageIndex;
    });

    if (canvas == null || selectedSignature.signature.pageIndex < 0 || selectedSignature.signature.pageIndex >= pdfDoc.numPages) {
      return;
    }

    renderSignaturesPage(selectedSignature.signature.pageIndex, canvas.getContext('2d'))
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

    const canvas = signaturesCanvases.find((canvas) => {
      return signaturesCanvasToPageIndex.get(canvas) === selectedSignature.signature.pageIndex;
    });

    if (canvas == null || selectedSignature.signature.pageIndex < 0 || selectedSignature.signature.pageIndex >= pdfDoc.numPages) {
      return;
    }

    renderSignaturesPage(selectedSignature.signature.pageIndex, canvas.getContext('2d'))
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

    const canvas = signaturesCanvases.find((canvas) => {
      return signaturesCanvasToPageIndex.get(canvas) === selectedSignature.signature.pageIndex;
    });

    if (canvas == null || selectedSignature.signature.pageIndex < 0 || selectedSignature.signature.pageIndex >= pdfDoc.numPages) {
      return;
    }

    renderSignaturesPage(selectedSignature.signature.pageIndex, canvas.getContext('2d'))
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

    const canvas = signaturesCanvases.find((canvas) => {
      return signaturesCanvasToPageIndex.get(canvas) === selectedSignature.signature.pageIndex;
    });

    if (canvas == null || selectedSignature.signature.pageIndex < 0 || selectedSignature.signature.pageIndex >= pdfDoc.numPages) {
      return;
    }

    renderSignaturesPage(selectedSignature.signature.pageIndex, canvas.getContext('2d'))
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
