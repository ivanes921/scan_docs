const pdfInput = document.getElementById("pdfInput");
const signatureInput = document.getElementById("signatureInput");
const uploadForm = document.getElementById("uploadForm");
const pagesContainer = document.getElementById("pagesContainer");
const formStatus = document.getElementById("formStatus");
const signatureHint = document.getElementById("signatureHint");

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

let pdfData = null;
let pdfDocument = null;
let signatureDataUrl = null;
let signatureRatio = 1;

const pageState = new Map();

function clearPreview() {
  pagesContainer.innerHTML = "";
  pageState.clear();
}

async function renderPdf(arrayBuffer) {
  clearPreview();
  pdfDocument = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.3 });
    const canvas = document.createElement("canvas");
    canvas.classList.add("page-canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext("2d");

    await page.render({ canvasContext: context, viewport }).promise;

    const pageWrapper = document.createElement("div");
    pageWrapper.className = "page-wrapper";
    pageWrapper.dataset.pageIndex = String(pageNumber - 1);

    const canvasWrapper = document.createElement("div");
    canvasWrapper.className = "canvas-wrapper";
    canvasWrapper.style.width = `${viewport.width}px`;
    canvasWrapper.style.height = `${viewport.height}px`;
    canvasWrapper.appendChild(canvas);

    const signatureLayer = document.createElement("div");
    signatureLayer.className = "signature-layer";
    canvasWrapper.appendChild(signatureLayer);

    const controls = document.createElement("div");
    controls.className = "page-controls";
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "button button--secondary";
    addButton.textContent = "Добавить подпись";
    addButton.addEventListener("click", () => {
      if (!signatureDataUrl) {
        formStatus.textContent = "Сначала загрузите изображение подписи.";
        return;
      }
      createSignatureInstance(signatureLayer, canvasWrapper, pageNumber - 1);
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "button button--ghost";
    removeButton.textContent = "Удалить подпись";
    removeButton.addEventListener("click", () => {
      const existing = signatureLayer.querySelector(".signature-instance");
      if (existing) {
        signatureLayer.removeChild(existing);
        pageState.delete(pageNumber - 1);
      }
    });

    controls.appendChild(addButton);
    controls.appendChild(removeButton);

    pageWrapper.appendChild(canvasWrapper);
    pageWrapper.appendChild(controls);
    pagesContainer.appendChild(pageWrapper);
  }
}

function createSignatureInstance(layer, canvasWrapper, pageIndex) {
  layer.innerHTML = "";
  const instance = document.createElement("div");
  instance.className = "signature-instance";
  instance.style.backgroundImage = `url(${signatureDataUrl})`;

  const wrapperWidth = canvasWrapper.offsetWidth;
  const wrapperHeight = canvasWrapper.offsetHeight;
  const defaultWidth = wrapperWidth * 0.35;
  const defaultHeight = defaultWidth / signatureRatio;

  instance.style.width = `${defaultWidth}px`;
  instance.style.height = `${defaultHeight}px`;
  instance.style.left = `${(wrapperWidth - defaultWidth) / 2}px`;
  instance.style.top = `${wrapperHeight - defaultHeight - 30}px`;

  instance.dataset.pageIndex = String(pageIndex);

  layer.appendChild(instance);
  setupInteract(instance, canvasWrapper, pageIndex);
  updatePlacement(instance, canvasWrapper, pageIndex);
}

function setupInteract(instance, canvasWrapper, pageIndex) {
  interact(instance)
    .draggable({
      listeners: {
        move(event) {
          const target = event.target;
          const x = (parseFloat(target.getAttribute("data-x")) || 0) + event.dx;
          const y = (parseFloat(target.getAttribute("data-y")) || 0) + event.dy;

          target.style.transform = `translate(${x}px, ${y}px)`;
          target.setAttribute("data-x", x);
          target.setAttribute("data-y", y);
        },
        end(event) {
          const target = event.target;
          applyTransform(target);
          updatePlacement(target, canvasWrapper, pageIndex);
        },
      },
      modifiers: [
        interact.modifiers.restrictRect({
          restriction: "parent",
          endOnly: true,
        }),
      ],
    })
    .resizable({
      edges: { left: true, right: true, bottom: true, top: true },
      listeners: {
        move(event) {
          const target = event.target;
          let { width, height } = event.rect;
          const x = event.deltaRect.left + (parseFloat(target.style.left) || 0);
          const y = event.deltaRect.top + (parseFloat(target.style.top) || 0);

          target.style.width = `${width}px`;
          target.style.height = `${height}px`;
          target.style.left = `${x}px`;
          target.style.top = `${y}px`;
        },
        end(event) {
          const target = event.target;
          target.style.transform = "translate(0, 0)";
          target.removeAttribute("data-x");
          target.removeAttribute("data-y");
          updatePlacement(target, canvasWrapper, pageIndex);
        },
      },
      modifiers: [
        interact.modifiers.restrictRect({
          restriction: "parent",
          endOnly: true,
        }),
      ],
    });
}

function applyTransform(target) {
  const x = parseFloat(target.getAttribute("data-x")) || 0;
  const y = parseFloat(target.getAttribute("data-y")) || 0;
  target.style.left = `${(parseFloat(target.style.left) || 0) + x}px`;
  target.style.top = `${(parseFloat(target.style.top) || 0) + y}px`;
  target.style.transform = "translate(0, 0)";
  target.removeAttribute("data-x");
  target.removeAttribute("data-y");
}

function updatePlacement(target, canvasWrapper, pageIndex) {
  const wrapperWidth = canvasWrapper.offsetWidth;
  const wrapperHeight = canvasWrapper.offsetHeight;
  const left = parseFloat(target.style.left) || 0;
  const top = parseFloat(target.style.top) || 0;
  const width = parseFloat(target.style.width) || 0;
  const height = parseFloat(target.style.height) || 0;

  const placement = {
    page: pageIndex,
    x: left / wrapperWidth,
    y: top / wrapperHeight,
    width: width / wrapperWidth,
    height: height / wrapperHeight,
  };

  pageState.set(pageIndex, placement);
}

pdfInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    clearPreview();
    pdfData = null;
    return;
  }

  const buffer = await file.arrayBuffer();
  pdfData = buffer;
  renderPdf(buffer).catch((error) => {
    console.error(error);
    formStatus.textContent = "Не удалось отобразить документ.";
  });
});

signatureInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    signatureDataUrl = null;
    signatureHint.textContent = "Чтобы разместить подпись, загрузите изображение подписи.";
    pagesContainer
      .querySelectorAll(".signature-layer")
      .forEach((layer) => (layer.innerHTML = ""));
    pageState.clear();
    return;
  }

  const reader = new FileReader();
  reader.onload = (loadEvent) => {
    signatureDataUrl = loadEvent.target?.result;
    const probe = new Image();
    probe.onload = () => {
      signatureRatio = probe.width / probe.height;
      signatureHint.textContent =
        "Нажмите «Добавить подпись» на нужной странице и перетащите подпись в нужное место.";
    };
    if (typeof signatureDataUrl === "string") {
      probe.src = signatureDataUrl;
    }
  };
  reader.readAsDataURL(file);
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!pdfInput.files?.length) {
    formStatus.textContent = "Загрузите PDF документ.";
    return;
  }

  formStatus.textContent = "Обработка…";

  const formData = new FormData();
  formData.append("pdf_file", pdfInput.files[0]);
  if (signatureInput.files?.length) {
    formData.append("signature_file", signatureInput.files[0]);
  }

  const placements = Array.from(pageState.values());
  formData.append("placements", JSON.stringify(placements));
  const filterType = uploadForm.querySelector('input[name="filter_type"]:checked').value;
  formData.append("filter_type", filterType);

  try {
    const response = await fetch("/process", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || "Ошибка обработки документа");
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "scan_result.pdf";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    formStatus.textContent = "Документ готов и скачан.";
  } catch (error) {
    console.error(error);
    formStatus.textContent = error.message || "Произошла ошибка.";
  }
});
