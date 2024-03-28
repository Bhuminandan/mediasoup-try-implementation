import io from 'socket.io-client'

let socket;
const createSocketConnection = () => {
    if (socket && socket.connected) {
        console.log('socket connected');
        return socket;
    } else {
        socket = io('https://localhost:9000/mediasoup');

        return socket;
    }
}

export default createSocketConnection