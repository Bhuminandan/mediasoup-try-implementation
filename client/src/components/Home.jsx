import React, { useCallback, useEffect, useRef, useState } from 'react'
import createSocketConnection from '../utilities/createSocketConnection'
import  { Device } from "mediasoup-client"

const Home = () => {

    const [socketState, setSocketState] = useState(null)
    const [deviceState, setDeviceState] = useState(null)
    const [startRecvClicked, setStartRecvClicked] = useState(false)
    const [producer, setProducer] = useState(null)
    const [consumer, setConsumer] = useState(null)
    const [params, setParams] = useState({
        encoding: [
            {
                rid: 'r0',
                maxBitrate: 100000,
                scalabilityMode: 'S1T3'
            },
            {
                rid: 'r1',
                maxBitrate: 300000,
                scalabilityMode: 'S1T3'
            },
            {
                rid: 'r2',
                maxBitrate: 900000,
                scalabilityMode: 'S1T3'
            }
        ],
        codecOptions: {
            videoGoogleStartBitrate: 1000
        }
    })
    const [deivceLoaded, setDeviceLoaded] = useState(false)
    const [producerTransport, setProducerTransport] = useState(null)
    const [consumerTransport, setConsumerTransport] = useState(null)
    const [localStream, setLocalStream] = useState(null)
    const [routerRtpCapabilities, setRouterRtpCapabilities] = useState(null)
    const [isProducerExists, setIsProducerExists] = useState(false)
    const localVideoRef = useRef(null)
    const remoteVideoRef = useRef(null)

    // Making the socket connection
    useEffect(() => {
        const socket = createSocketConnection();

        console.log('socket>>>', socket)
        console.log('socket>>>', socket.connected)

        setSocketState(socket)

        return () => {
            socket.disconnect();
        };
    }, []);

    // Once we have the socketState lets get the routerRtpCapabilities
    useEffect(() => {
        if (socketState) {
            socketState.emit('getRouterRtpCapabilities', ({ routerRtpCapabilities }) => {
                console.log("Got the routerRtpCapabilities>>>", routerRtpCapabilities)
                setRouterRtpCapabilities(routerRtpCapabilities)
            });
        }
    }, [socketState]);

    // once we have the routerRtpCapabilities lets create a device
    useEffect(() => {
        
        const createAndLoadDevice = async () => {
            try {
                let device = new Device();

                console.log("Loading device>>>", device)
                await device.load({ routerRtpCapabilities });
                
                setDeviceLoaded(true)
                setDeviceState(device)

            } catch (error) {
                if (error.name === 'UnsupportedError') {
                    console.log("Browser not supported")
                    return;
                }
                console.warn("Getting the error inside createAndLoadDevice", error)
            }
        }

        if (routerRtpCapabilities) {
            createAndLoadDevice();
        }

    }, [routerRtpCapabilities]);

    // Getting the local video
    const getLocalVideo = useCallback( async () => {
        const localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

        setLocalStream(localStream)

        console.log("Got the local stream>>>", localStream)

        const track = localStream.getVideoTracks()[0];

        console.log("Got the local video track>>>", track)

        setParams({ 
            track,
            ...params
        });

        localVideoRef.current.srcObject = localStream;
    }, []);

    // Once we have the localstream we will start to createwebrtc transport
    useEffect(() => {

        const createWebRTCTransport = () => {
            socketState.emit('createWebRTCTransport', { sender: true }, ({ params }) => {
                if (params.errro) {
                    console.log("Got the error inside createWebRTCTransport", params.error)
                }

                console.log("Got the params inside createWebRTCTransport>>>", params)

                const producerTransport = deviceState.createSendTransport(params);

                console.log("Got the producerTransport>>>", producerTransport)

                producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
                    try {
                        
                        // Signal the local dtlsParameters to the server side transport
                        await socketState.emit('transport-connect', { dtlsParameters })

                        // Once that done Tell the transport that parameters were transmitted
                        callback()

                    } catch (error) {
                        console.log('Got the error inside connect>>>', error)
                        errback(error)
                    }
                })

                producerTransport.on('produce', async (parameters, callback, errback) => {

                    try {
                        await socketState.emit('transport-produce', { 
                            transportId: producerTransport.id,
                            kind: parameters.kind,
                            rtpParameters: parameters.rtpParameters,
                            appData: parameters.appData
                         }, ({ id }) => {
                             
                            callback({ id })
                         })
                        callback({ id: parameters.id })
                    } catch (error) {
                        console.log('Got the error inside produce>>>', error)
                        errback(error)
                    }
                })


                setProducerTransport(producerTransport)

            })
        }
        
        if (localStream) {
           createWebRTCTransport();
        }

    },[localStream])

    // Once we have the producerTransport we can call the connectSendTrasnport
    useEffect(() => {

        const connectSendTransport = async () => {
            
            try {

                console.log("Got the producerTransport>>>", params)

                const producer  = await producerTransport.produce(params);

                console.log("Got the producer>>>", producer)

                producer.on('transportclose', () => {
                    producer.close()
                })

                producer.on('trackended', () => {
                    producer.close()
                })

                setProducer(producer)
                
            } catch (error) {
                console.log('Got the error inside connectSendTransport>>>', error)
            }
            
        }
        
        if (producerTransport) {
            connectSendTransport();
        }

    }, [producerTransport]);


    // -------------------------- END OF PRODUCER CODE --------------------------


    // -------------------------- START OF CONSUMER CODE --------------------------

    // At this time we should have already device and rtpCapabilities
    useEffect(() => {

        const createRecvTransport = async () => {

            try {

                await socketState.emit('createWebRTCTransport', { sender: false }, ({ params }) => {
                    if (params.errro) {
                        console.log("Got the error inside createWebRTCTransport", params.error)
                    }

                    console.log("Got the params inside createWebRTCTransport>>>", params)

                    const consumerTransport = deviceState.createRecvTransport(params);

                    consumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {

                        try {
                            await socketState.emit('transport-recv-connect', { dtlsParameters })
                            callback()
                        } catch (error) {
                            console.log('Got the error inside connect>>>', error)
                            errback(error)
                        }
                    })

                    setConsumerTransport(consumerTransport)

                    console.log("Got the consumerTransport>>>", consumerTransport)

                })
                
            } catch (error) {
                console.log('Got the error inside createRecvTransport>>>', error)
            }

        }

        if (deviceState && routerRtpCapabilities && startRecvClicked) {
            createRecvTransport();
        }
    }, [startRecvClicked]);


    // Now once we have created the recvTransport we can call the connectRecvTransport
    useEffect(() => {

        const connectRecvTransport = async () => {
            try {
                await socketState.emit('consume', { rtpCapabilities: deviceState.rtpCapabilities}, async ({ params }) => {
                    if (params.error) {
                        console.log("Got the error inside consume", params.error)
                        return;
                    }

                    console.log("Got the params inside consume>>>", params)

                    const consumer = await consumerTransport.consume({
                        id: params.id,
                        producerId: params.producerId,
                        kind: params.kind,
                        rtpParameters: params.rtpParameters,
                        appData: params.appData
                    });

                    const { track } = consumer;

                    remoteVideoRef.current.srcObject = new MediaStream([track]);

                    setConsumer(consumer);

                    socketState.emit('consumer-resume', {
                        consumerId: consumer.id
                    })
                    
                })
            } catch (error) {
                console.log('Got the error inside connectRecvTransport>>>', error)
            }
        }

        if (consumerTransport) {
            connectRecvTransport();
        }
    },[consumerTransport])

    // -------------------------- END OF CONSUMER CODE --------------------------

  return (
    
    <div className='h-screen flex items-center justify-between bg-slate-600 p-10'>
        <div className='w-1/2  h-full border flex flex-col p-20 items-start justify-between'>
            <div>
                <video id="localVideo" className='rounded-2xl' ref={localVideoRef} autoPlay playsInline muted></video>
            </div>
            <div className='flex items-center justify-center gap-5'>
                <button className='bg-slate-200 p-2 rounded-2xl font-medium' id="startButton" onClick={getLocalVideo}>Start</button>
                <button className='bg-slate-200 p-2 rounded-2xl font-medium' id="callButton" onClick={() => setStartRecvClicked(true)}>Remote</button>
                <button className='bg-slate-200 p-2 rounded-2xl font-medium' id="hangupButton">Hang Up</button>
            </div>
        </div>
        <div className='w-1/2 h-full border flex flex-col p-20 items-start justify-between'>
            <video ref={remoteVideoRef} className='rounded-2xl' id="remoteVideo" autoPlay playsInline></video>
        </div>
    </div>
    
  )
}

export default Home