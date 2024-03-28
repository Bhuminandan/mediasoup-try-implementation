import fs from 'fs'
import https from 'https'
import express from 'express'
import { Server } from 'socket.io'
import cors from 'cors'
import mediasoup from 'mediasoup'

const app = express()

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static('public'))
app.use(cors(
    {
        origin: '*'
    }
))

const certsKeys = {
    key: fs.readFileSync('./certs/cert.key'),
    cert: fs.readFileSync('./certs/cert.crt')
}

const expressServer = https.createServer(certsKeys, app)
const io = new Server(expressServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    }
})

const peers = io.of('/mediasoup')

const mediaCodecs = [
    {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2
    },
    {
        kind: 'video',
        mimeType: 'video/vp8',
        clockRate: 90000,
        parameters: {
            'x-google-start-bitrate': 1000
        }
    }
]


// Imp Variables
let worker
let router
let socketId
let roomId
let producerId
let consumerId
let producerTransport
let consumerTransport
let producer
let consumer



// Function to create worker
const createWorker = async () => {
    worker = await mediasoup.createWorker({
        logLevel: 'warn',
        logTags: [
            'info',
            'ice',
            'dtls',
            'rtp',
            'srtp',
            'rtcp',
            'rtx',
            'bwe',
            'score',
            'simulcast',
            'svc'
        ],
        rtcMinPort: 40000,
        rtcMaxPort: 49999
    })


    console.log('Worker created successfully [pid:%d]', worker.pid)

    worker.on('died', () => {
        console.error('mediasoup worker died, exiting in 2 seconds... [pid:%d]', worker.pid)
        setTimeout(() => process.exit(1), 2000)
    }) 
}

worker = createWorker()


peers.on('connection', async (socket) => {
    console.log('peer connected', socket.id)

    
    socket.emit('connection-success', {
        socketId: socket.id,
    })

    socket.on('disconnect', () => {
        console.log('peer disconnected')
    })

    if(!worker) {
        worker = await createWorker()
    }

    router = await worker.createRouter({
        mediaCodecs
    })

    socket.on('getRouterRtpCapabilities', (callback) => {
        callback({
            routerRtpCapabilities: router.rtpCapabilities
        })
    })

    socket.on('createWebRTCTransport', async ( { sender }, callback) => {
        
        if (sender) {
            producerTransport = await createWebRtcTransport(callback)
        } else {
            consumerTransport = await createWebRtcTransport(callback)
        }

    })


    socket.on("transport-connect", async ({ dtlsParameters }) => {
        try {
            await producerTransport.connect({ dtlsParameters })
        } catch (error) {
            console.log('Got the error inside transport-connect>>>', error)
        }
    })


    socket.on("transport-produce", async ({ kind, rtpParameters, appData }, callback) => {
        try {
            producer = await producerTransport.produce({ kind, rtpParameters, appData })

            console.log("Got the producer>>>", producer.id, producer.kind)

            producer.on('transportclose', () => {
                producer.close()
            })

            producer.on('trackended', () => {
                producer.close()
            })

            callback({ id: producer.id })
        } catch (error) {
            console.log('Got the error inside transport-produce>>>', error)
        }
    })

    socket.on("transport-recv-connect", async ({ dtlsParameters }) => {
        try {
            await consumerTransport.connect({ dtlsParameters })
        } catch (error) {
            console.log('Got the error inside transport-recv-connect>>>', error)
        }
    })

    socket.on('consume', async ({ rtpCapabilities }, callback) => {
        try {
            
            if (router.canConsume({ producerId : producer.id, rtpCapabilities })) {
                consumer = await consumerTransport.consume({
                    producerId : producer.id,
                    rtpCapabilities,
                    paused: true
                })

                consumer.on('transportclose', () => {
                    consumer.close()
                })

                consumer.on('producerclose', () => {
                    consumer.close()
                })

                callback({
                    params: {
                        id: consumer.id,
                        producerId: producer.id,
                        kind: consumer.kind,
                        rtpParameters: consumer.rtpParameters,
                        appData: consumer.appData
                    }
                })
                
            }

        } catch (error) {
            console.log('Got the error inside consume>>>', error)
            callback({
                params: {
                    error
                }
            })
        }
    })

    socket.on('consumer-resume', async () => {
        try {
            if (consumer) {
               await consumer.resume()
            }
        } catch (error) {
            console.log('Got the error inside consumer-resume>>>', error)
        }
    })

})


expressServer.listen(9000, () => {
    console.log('Listening on port 9000')
})


const createWebRtcTransport = async (callback) => {
   
    try {

        const webRtc_Options = {
            listenIps: [
                {
                    ip: '127.0.0.1',
                    announcedIp: '127.0.0.1'
                }
            ],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true
        }


        const webRtcTransport = await router.createWebRtcTransport(webRtc_Options)
        // console.log("Got the webRtcTransport>>>", webRtcTransport)


        webRtcTransport.on('dtlsstatechange', (state) => {
            console.log("Got the dtlsstatechange>>>", state)

            if (state === 'closed') {
                webRtcTransport.close()
            }
        })


        webRtcTransport.on('close', () => {
            console.log("Got the close>>>")

            webRtcTransport.close()
        })

        callback({
            params: {
                id: webRtcTransport.id,
                iceParameters: webRtcTransport.iceParameters,
                iceCandidates: webRtcTransport.iceCandidates,
                dtlsParameters: webRtcTransport.dtlsParameters,
                sctpParameters: webRtcTransport.sctpParameters
            }
        })
        
        return webRtcTransport
    } catch (error) {
        console.log("Getting the error inside createWebRtcTransport", error)

        callback({
            params: {
                error
            }
        })
    }

}






export { io, expressServer, app }