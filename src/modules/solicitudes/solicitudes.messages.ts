/**
 * Lo que lee el solicitante cuando su solicitud se cierra sola. Sin adjetivos con género
 * (el backend no conoce el de la mascota) y sin culpar: la solicitud no se cae por algo que
 * hizo la persona.
 */
import type { MotivoSolicitud } from '@prisma/client';

export function textoDeCierre(motivo: MotivoSolicitud, nombreMascota: string): string {
  switch (motivo) {
    case 'ADOPTADA_POR_OTRA_PERSONA':
      return `${nombreMascota} ya encontró su hogar. Gracias por haberte interesado: hay muchas mascotas esperándote.`;
    case 'MASCOTA_FALLECIDA':
      return `Con mucha tristeza te contamos que ${nombreMascota} falleció. Gracias por tu interés y tu cariño.`;
    case 'PUBLICACION_RETIRADA':
      return `La publicación de ${nombreMascota} se retiró, por eso cerramos tu solicitud. Si querés saber más, escribile por el chat.`;
    case 'PUBLICANTE_CERRO_CUENTA':
      return `Quien publicó a ${nombreMascota} cerró su cuenta, así que cerramos tu solicitud. Lamentamos las molestias.`;
    case 'VENCIDA_SIN_RESPUESTA':
      return `Pasó mucho tiempo sin novedades y cerramos tu solicitud por ${nombreMascota}. No es por vos: podés volver a solicitarla cuando quieras.`;
    default:
      return `Tu solicitud por ${nombreMascota} se cerró.`;
  }
}
