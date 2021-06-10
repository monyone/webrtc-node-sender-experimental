import Peer from 'simple-peer'
const socket = new window.WebSocket('ws://' + location.hostname + ':9000')

socket.addEventListener('open', () => {
    const peer = new Peer({ initiator: true, config: { iceServers: []} })

    peer.on('signal', (data) => {
        socket.send(JSON.stringify(data))
    })

    socket.addEventListener('message', (event) => {
        peer.signal(event.data)
    })

    peer.on('stream', async (stream) => {
        console.log(stream)
        const video = document.getElementById('video')
        video.srcObject = stream
        video.load()
        try {
            await video.play()
        } catch {
            video.muted = true
            await video.play()
        }
    })
    peer.on('error', (error) => {
        console.error(error);
    })
})

