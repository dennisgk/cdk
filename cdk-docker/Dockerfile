FROM debian:bookworm-slim AS source

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

RUN git clone https://github.com/dennisgk/cdk .


FROM node:22-bookworm-slim AS web-build

WORKDIR /build/cdk-react

COPY --from=source /src/cdk-react/package.json /src/cdk-react/package-lock.json* ./
RUN npm ci

COPY --from=source /src/cdk-react/ ./
RUN npm run build


FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV HOST=0.0.0.0
ENV PORT=21035

WORKDIR /app

COPY --from=source /src/cdk-python/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY --from=source /src/cdk-python/app ./app
COPY --from=source /src/cdk-python/run.py ./run.py
COPY --from=source /src/cdk-python/generate_password_hash.py ./generate_password_hash.py
COPY --from=web-build /build/cdk-react/dist ./static
COPY config.json ./config.json

EXPOSE 21035

CMD ["python", "run.py"]
