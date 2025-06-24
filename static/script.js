import * as pdfjs from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url';
import SignaturePad from 'signature_pad';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

const signaturePadCanvas = document.getElementById("signaturePadCanvas");
const pdfInput = document.getElementById('pdfInput');
const pdfInputButton = document.getElementById('pdfInputButton');
const pagesContainer = document.getElementById('pagesContainer');
const zoomOutButton = document.getElementById('zoomOutButton');
const zoomInButton = document.getElementById('zoomInButton');
const signButton = document.getElementById('signButton');
const signaturesModal = document.getElementById('signaturesModal');
const signaturesContainer = document.getElementById('signaturesContainer');
const newSignatureButton = document.getElementById('newSignatureButton');
const signaturePadModal = document.getElementById('signaturePadModal');
const clearNewSignatureButton = document.getElementById('clearNewSignatureButton');
const cancelNewSignatureButton = document.getElementById('cancelNewSignatureButton');
const createNewSignatureButton = document.getElementById('createNewSignatureButton');

const devicePixelRatio = Math.max(window.devicePixelRatio || 1, 1);

const signaturePad = new SignaturePad(signaturePadCanvas);
signaturePadCanvas.style.width = `${signaturePadCanvas.width}px`;
signaturePadCanvas.style.height = `${signaturePadCanvas.height}px`;
signaturePadCanvas.width *= devicePixelRatio;
signaturePadCanvas.height *= devicePixelRatio;
signaturePadCanvas.getContext("2d").scale(devicePixelRatio, devicePixelRatio);
signaturePad.clear();


let globalPdfDoc = null;

let pdfCanvases = [];
let signaturesCanvases = [];

let signatures = [];

let zoomPercentage = 100;

pdfInputButton.addEventListener('click', () => {
    pdfInput.click();
});

pdfInput.addEventListener('change', async (event) => {
    const pdfFile = event.target.files[0];

    if (!pdfFile) {
        return;
    }

    pdfInputButton.hidden = true;

    const pdfBytes = await pdfFile.arrayBuffer();
    const pdfDoc = await pdfjs.getDocument({ data: pdfBytes }).promise; // TODO: some validation regarding `pdfDoc.numPages` should be done

    pdfCanvases = new Array(pdfDoc.numPages);
    signaturesCanvases = new Array(pdfDoc.numPages);

    for (let index = 0; index < pdfDoc.numPages; index++) {
        const pdfCanvas = document.createElement('canvas');
        pdfCanvas.className = 'pdfCanvas';

        const signaturesCanvas = document.createElement('canvas');
        signaturesCanvas.className = 'signaturesCanvas';

        const pageContainer = document.createElement('div');
        pageContainer.className = 'pageContainer';
        pageContainer.appendChild(pdfCanvas);
        pageContainer.appendChild(signaturesCanvas);

        pagesContainer.appendChild(pageContainer);

        pdfCanvases[index] = pdfCanvas;
        signaturesCanvases[index] = signaturesCanvas;
    }

    // TODO: transform this into a proper async and await for it
    render(pdfDoc);

    pagesContainer.hidden = false;
    zoomOutButton.hidden = false;
    zoomInButton.hidden = false;
    signButton.hidden = false;

    globalPdfDoc = pdfDoc;
});

// TODO: if this is slow on big documents, i can either try to cancel the previous render request after this is clicked, or just not render all
// canvases at once, only the one on screen and the few before and next
// DETAIL: i need to remember to set the inner elements height as if all pages were being rendered, so the scroll works properly
// example on https://github.com/ribeirotomas1904/ahrefs-task
zoomOutButton.addEventListener('click', (event) => {
    zoomPercentage = Math.max(zoomPercentage - 10, 10);
    render(globalPdfDoc);
});

zoomInButton.addEventListener('click', (event) => {
    zoomPercentage = Math.min(zoomPercentage + 10, 1000);
    render(globalPdfDoc);
});

signButton.addEventListener('click', (event) => {
    signaturesModal.hidden = !signaturesModal.hidden;
});

newSignatureButton.addEventListener('click', (event) => {
    signaturePadModal.hidden = false;
    signaturesModal.hidden = true;
});

clearNewSignatureButton.addEventListener('click', (event) => {
    clearSignaturePad();
});

cancelNewSignatureButton.addEventListener('click', (event) => {
    signaturePadModal.hidden = true;
    clearSignaturePad();
});

function clearSignaturePad() {
    signaturePad.clear();
    clearNewSignatureButton.disabled = true;
    createNewSignatureButton.disabled = true;
}

signaturePad.addEventListener('beginStroke', (event) => {
    clearNewSignatureButton.disabled = false;
    createNewSignatureButton.disabled = false;
});

createNewSignatureButton.addEventListener('click', (event) => {


    const div = document.createElement('div');
    div.id = 'signatureContainer';

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Deletar';

    const img = document.createElement('img'); // TODO: what will I see of dimensions when dowloading it?

    img.addEventListener('load', (event) => {

        const newSignature = {
            id: Symbol(),
            img,
            // TODO: add position and individual scaling
        };
        signatures.push(newSignature);

        button.addEventListener('click', (event) => {
            signatures = signatures.filter((signature) => signature.id !== newSignature.id);
            div.remove();
        });

        const draw = () => {
            const context = signaturesCanvases[0].getContext('2d');

            const ratio = devicePixelRatio * (zoomPercentage / 100);

            // TODO: should I control this by myself or should I use scale/transform? what about in drawing the pdf?
            context.drawImage(
                img,
                0 * ratio,
                0 * ratio,
                img.width * ratio,
                img.height * ratio,
            );
        };

        draw();

        img.addEventListener('click', (event) => {
            draw();
        });
    });
    img.src = signaturePad.toDataURL("image/svg+xml");



    div.appendChild(img);
    div.appendChild(button);

    signaturesContainer.appendChild(div);

    signaturePadModal.hidden = true;
    clearSignaturePad();
});


// TODO: transform this into a proper async and await for it
// of couse, rendering them in parallel
// TODO: rendering multiple times in a row causes problems
// TODO: pdfCanvas is 4 pixels smaller than pageContainer somehow, it doesn't seem to be a problem on the css file
function render(pdfDoc) {
    const startRenderTime = performance.now();
    let tasksDoneCount = 0;

    pdfCanvases.forEach(async (pdfCanvas, index) => {
        const signaturesCanvas = signaturesCanvases[index];

        // TODO: I can call this on render, and cache it
        const page = await pdfDoc.getPage(index + 1);

        const viewport = page.getViewport({ scale: 1 });
        const containerHeight = pagesContainer.getBoundingClientRect().height;
        const desiredHeight = containerHeight * (zoomPercentage / 100);
        const scale = desiredHeight / viewport.height;

        const scaledViewport = page.getViewport({ scale });

        const transform = [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0];

        pdfCanvas.width = scaledViewport.width * devicePixelRatio;
        pdfCanvas.height = scaledViewport.height * devicePixelRatio;
        pdfCanvas.style.width = `${Math.floor(scaledViewport.width)}px`;
        pdfCanvas.style.height = `${Math.floor(scaledViewport.height)}px`;

        signaturesCanvas.width = scaledViewport.width * devicePixelRatio;
        signaturesCanvas.height = scaledViewport.height * devicePixelRatio;

        // TODO: I need to set the css sizes to be the same I expect to draw before scaling
        // because the canvas sizes will be ints I guess, and css accepts floats, so I should round before setting the css styles 
        signaturesCanvas.style.width = `${Math.floor(scaledViewport.width)}px`;
        signaturesCanvas.style.height = `${Math.floor(scaledViewport.height)}px`;
        // TODO: should I set the scale transform of signaturesCanvas here? no, i just need to scale before draw




        // START TEMP -------------------------------------------
        // TODO: signaturesCanvas is being cleared because it's async-ly change the sizes after this
        // TODO: this is a temp way to redraw signatures after scaling
        const draw = (signature) => {
            console.log({ signature });


            const context = signaturesCanvases[0].getContext('2d');

            const ratio = devicePixelRatio * (zoomPercentage / 100);

            // TODO: should I control this by myself or should I use scale/transform? what about in drawing the pdf?
            context.drawImage(
                signature.img,
                0 * ratio,
                0 * ratio,
                signature.img.width * ratio,
                signature.img.height * ratio,
            );
        };

        signatures.forEach(draw);
        console.log({ signatures })
        // END TEMP -------------------------------------------


        const canvasContext = pdfCanvas.getContext('2d');

        await page.render({ canvasContext, transform, viewport: scaledViewport }).promise;

        tasksDoneCount++;
        if (tasksDoneCount === pdfCanvases.length) {
            console.log("render time:", performance.now() - startRenderTime);
        }
    });



}