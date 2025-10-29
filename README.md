Веб-приложение, позволяющее имитировать сканирование PDF-документа, добавлять графическую подпись и выбирать итоговую цветовую схему.

## Возможности

- Загрузка PDF-документа для предпросмотра и обработки.
- Опциональная загрузка изображения подписи (PNG/JPG).
- Визуальное размещение подписи на выбранных страницах с изменением размера и положения.
- Выбор цветовой схемы сканирования: цветной, оттенки серого, чёрно-белый.
- Выгрузка готового PDF-файла с эффектом сканера.

## Запуск

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

После запуска перейдите по адресу [http://localhost:8000](http://localhost:8000) и загрузите документ.

## Применяемые технологии

- [FastAPI](https://fastapi.tiangolo.com/) — backend и обработка PDF.
- [PyMuPDF](https://pymupdf.readthedocs.io/) — модификация и отрисовка страниц PDF.
- [Pillow](https://python-pillow.org/) и [NumPy](https://numpy.org/) — пост-обработка изображения (эффект скана, шум, виньетка).
- [pdf.js](https://mozilla.github.io/pdf.js/) и [interact.js](https://interactjs.io/) — предпросмотр PDF и интерактивное размещение подписи в браузере.
