import { DateTime } from 'luxon';

export interface BookingMailData {
  plate: string;
  spotCode: string;
  from: Date;
  to: Date;
  timeZone: string;
}

const local = (d: Date, zone: string) =>
  DateTime.fromJSDate(d, { zone }).toFormat('dd.MM.yyyy HH:mm');
const localTime = (d: Date, zone: string) =>
  DateTime.fromJSDate(d, { zone }).toFormat('HH:mm');

/** Times are shown in the parking time zone (CLAUDE.md, principle 2). */
export function reminderMail(d: BookingMailData, beforeEndMin: number) {
  return {
    subject: `Бронь места ${d.spotCode} закончится через ${beforeEndMin} минут`,
    text:
      `Бронь места ${d.spotCode} для машины ${d.plate} заканчивается в ` +
      `${localTime(d.to, d.timeZone)} (${local(d.to, d.timeZone)}).\n` +
      `После окончания брони стоянка оплачивается по тарифу до выезда.\n`,
  };
}

export function noShowMail(d: BookingMailData, graceMin: number) {
  return {
    subject: `Бронь места ${d.spotCode} снята: машина не заехала`,
    text:
      `Машина ${d.plate} не заехала в течение ${graceMin} минут после начала брони ` +
      `места ${d.spotCode} (${local(d.from, d.timeZone)} – ` +
      `${localTime(d.to, d.timeZone)}). Бронь снята, место освобождено.\n` +
      `Плата за неиспользованную бронь не взимается.\n`,
  };
}
