# 使い方

## 動画を RTP で出す

映像/音声 をなるべく同期するため remux してから出力

```bash
something ... \
ffmpeg -fflags nobuffer -analyzeduration 500000 -max_delay 250000 -i - \
    -c:v libx264 -s 480x270 -threads 0 -intra -profile:v baseline -preset ultrafast -tune zerolatency,fastdecode \
    -c:a opus -strict -2 -ar 48000 -ac 2 -application lowdelay \
    -f mpegts pipe:1 | \
ffmpeg -f mpegts -fflags nobuffer -analyzeduration 1000000 -max_delay 250000 -i - \
    -an -c:v copy -f rtp rtp://127.0.0.1:5000 \
    -vn -c:a copy -f rtp rtp://127.0.0.1:5002
```


Raspberry Pi 4 で h264_omx でのハードウェアエンコードを行う場合はこうなる。

```bash
something ... \
ffmpeg -fflags nobuffer -analyzeduration 500000 -max_delay 250000 -i - \
    -c:v h264_omx -b:v 3M -profile:v baseline -flags:v +global_header \
    -c:a opus -strict -2 -ar 48000 -ac 2 -application lowdelay \
    -f mpegts pipe:1 | \
ffmpeg -f mpegts -fflags nobuffer -analyzeduration 1000000 -max_delay 250000 -i - \
    -an -c:v copy -f rtp rtp://127.0.0.1:5000 \
    -vn -c:a copy -f rtp rtp://127.0.0.1:5002
```

## サーバ側準備

server 側で yarn start

## クライアント側にアクセス

client 側の index.html をリモートで開く
