import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthUser, JwtPayload, ROLES } from '../auth/auth-user';
import { LOT, OPERATORS, ParkingEvent, route, userRoom } from './events';
import { PgListener } from './pg-listener.service';

/**
 * socket.io endpoint (path /socket.io). The JWT comes in the handshake
 * (`auth.token`); a socket without a valid one never connects.
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() private server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly listener: PgListener,
  ) {}

  afterInit(server: Server): void {
    server.use((socket, next) => {
      this.authenticate(socket)
        .then((user) => {
          (socket.data as { user?: AuthUser }).user = user;
          next();
        })
        .catch(() => next(new Error('UNAUTHORIZED')));
    });
    this.listener.onEvent((event) => this.broadcast(event));
  }

  async handleConnection(socket: Socket): Promise<void> {
    const user = (socket.data as { user: AuthUser }).user;
    await socket.join([
      LOT,
      userRoom(user.id),
      ...(user.role === 'operator' ? [OPERATORS] : []),
    ]);
    // Rooms are set: from here on the client misses nothing.
    socket.emit('session.ready', { userId: user.id, role: user.role });
  }

  private broadcast(event: ParkingEvent): void {
    const d = route(event);
    if (!d) {
      this.logger.warn(`unknown event ${JSON.stringify(event)}`);
      return;
    }
    // One emit to several rooms: a socket in two of them gets it once.
    this.server.to(d.rooms).emit(d.event, d.payload);
  }

  private async authenticate(socket: Socket): Promise<AuthUser> {
    const token: unknown = (socket.handshake.auth as { token?: unknown }).token;
    if (typeof token !== 'string') throw new Error('no token');
    const payload = await this.jwt.verifyAsync<JwtPayload>(token);
    if (typeof payload.sub !== 'string' || !ROLES.includes(payload.role)) {
      throw new Error('bad payload');
    }
    return { id: payload.sub, role: payload.role };
  }
}
