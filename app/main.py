import io
import json
from typing import List, Optional

import fitz
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from PIL import Image, ImageEnhance, ImageFilter

app = FastAPI(title="Document Scanner")

app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")


@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("index.html", {"request": request})


def _load_signature(signature_bytes: bytes) -> Image.Image:
    try:
        signature = Image.open(io.BytesIO(signature_bytes))
        if signature.mode not in ("RGBA", "RGB"):
            signature = signature.convert("RGBA")
        return signature
    except Exception as exc:  # pragma: no cover - defensive conversion
        raise HTTPException(status_code=400, detail="Не удалось загрузить изображение подписи") from exc


def _insert_signature(
    document: fitz.Document,
    signature: Image.Image,
    placements: List[dict],
) -> None:
    for placement in placements:
        page_index = placement.get("page")
        if page_index is None or page_index < 0 or page_index >= document.page_count:
            raise HTTPException(status_code=400, detail="Некорректный номер страницы для подписи")

        page = document.load_page(page_index)
        page_width = page.rect.width
        page_height = page.rect.height

        try:
            norm_x = float(placement["x"])
            norm_y = float(placement["y"])
            norm_width = float(placement["width"])
            norm_height = float(placement["height"])
        except (KeyError, TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="Некорректные параметры подписи") from exc

        if not (0 <= norm_x <= 1 and 0 <= norm_y <= 1 and 0 < norm_width <= 1 and 0 < norm_height <= 1):
            raise HTTPException(status_code=400, detail="Размеры подписи должны быть в диапазоне 0..1")

        abs_width = norm_width * page_width
        abs_height = norm_height * page_height
        left = norm_x * page_width
        # координата в PDF начинается снизу, поэтому преобразуем из top-left
        top_from_top = norm_y * page_height
        bottom = page_height - top_from_top - abs_height
        rect = fitz.Rect(left, bottom, left + abs_width, bottom + abs_height)

        resized_signature = signature.resize((max(int(abs_width), 1), max(int(abs_height), 1)))
        buffer = io.BytesIO()
        resized_signature.save(buffer, format="PNG")
        page.insert_image(rect, stream=buffer.getvalue())


def _apply_scan_effect(image: Image.Image, mode: str) -> Image.Image:
    if mode == "gray":
        processed = image.convert("L")
        processed = ImageEnhance.Contrast(processed).enhance(1.1)
    elif mode == "bw":
        processed = image.convert("L")
        processed = ImageEnhance.Contrast(processed).enhance(1.5)
        processed = processed.point(lambda p: 255 if p > 180 else 0)
    else:
        processed = image.convert("RGB")
        processed = ImageEnhance.Color(processed).enhance(0.9)

    if processed.mode != "RGB":
        processed = processed.convert("RGB")

    processed = ImageEnhance.Brightness(processed).enhance(1.05)
    processed = processed.filter(ImageFilter.SMOOTH)

    rng = np.random.default_rng()
    noise_scale = 12 if mode == "bw" else 8
    noise = rng.normal(0, noise_scale, (processed.height, processed.width, 3)).astype(np.int16)
    img_array = np.array(processed, dtype=np.int16)
    img_array = np.clip(img_array + noise, 0, 255).astype(np.uint8)
    processed = Image.fromarray(img_array, mode="RGB")

    vignette = _generate_vignette(processed.size)
    vignette = vignette.resize(processed.size)
    vignette = vignette.convert("L")
    processed = Image.composite(processed, Image.new("RGB", processed.size, (235, 235, 235)), vignette)

    return processed


def _generate_vignette(size: tuple[int, int]) -> Image.Image:
    width, height = size
    x = np.linspace(-1, 1, width)
    y = np.linspace(-1, 1, height)
    xv, yv = np.meshgrid(x, y)
    radius = np.sqrt(xv ** 2 + yv ** 2)
    mask = np.clip((radius - 0.6) * 2.0, 0, 1)
    mask = (mask * 255).astype(np.uint8)
    return Image.fromarray(mask, mode="L")


def _render_document_with_effect(document: fitz.Document, mode: str) -> bytes:
    output_doc = fitz.open()
    for page_index in range(document.page_count):
        page = document.load_page(page_index)
        pix = page.get_pixmap(dpi=200, alpha=False)
        page_image = Image.open(io.BytesIO(pix.tobytes("png")))
        processed_image = _apply_scan_effect(page_image, mode)

        buffer = io.BytesIO()
        processed_image.save(buffer, format="PNG")
        new_page = output_doc.new_page(width=processed_image.width, height=processed_image.height)
        new_page.insert_image(new_page.rect, stream=buffer.getvalue())

    return output_doc.tobytes()


@app.post("/process")
async def process_document(
    pdf_file: UploadFile = File(...),
    placements: str = Form("[]"),
    filter_type: str = Form("color"),
    signature_file: Optional[UploadFile] = File(None),
):
    if pdf_file.content_type not in {"application/pdf", "application/octet-stream"}:
        raise HTTPException(status_code=400, detail="Ожидается PDF документ")

    try:
        placements_data = json.loads(placements) if placements else []
        if not isinstance(placements_data, list):
            raise ValueError
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Некорректные данные о расположении подписи") from exc

    pdf_bytes = await pdf_file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Пустой PDF документ")

    document = fitz.open(stream=pdf_bytes, filetype="pdf")

    signature_image = None
    if signature_file is not None:
        signature_bytes = await signature_file.read()
        if signature_bytes:
            signature_image = _load_signature(signature_bytes)
            if placements_data:
                _insert_signature(document, signature_image, placements_data)
        else:
            signature_image = None
    elif placements_data:
        raise HTTPException(status_code=400, detail="Для вставки подписи нужно загрузить изображение")

    rendered_bytes = _render_document_with_effect(document, filter_type)

    output_stream = io.BytesIO(rendered_bytes)
    output_stream.seek(0)

    return StreamingResponse(
        output_stream,
        media_type="application/pdf",
        headers={
            "Content-Disposition": "attachment; filename=scan_result.pdf",
        },
    )


if __name__ == "__main__":  # pragma: no cover - manual launch helper
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
