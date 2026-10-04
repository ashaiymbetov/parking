import { Injectable } from '@nestjs/common';
import { Clock } from './clock';

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    // The only place in the app allowed to read the wall clock.
    return new Date();
  }
}
