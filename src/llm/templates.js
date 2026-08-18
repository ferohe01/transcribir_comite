/**
 * Plantillas de post-proceso.
 *
 * En la version anterior el "modo estandar" no era una transcripcion: aplicaba
 * siempre el prompt de evaluacion de proyectos. Aqui esa logica se convierte en
 * una plantilla mas entre varias, y la transcripcion literal queda como el
 * resultado base sobre el que se puede aplicar cualquiera de ellas: las veces
 * que haga falta y sin volver a transcribir.
 */

export const SYSTEM_PROMPT =
  'Eres un asistente especializado en procesar transcripciones de audio y extraer ' +
  'informacion estructurada segun las instrucciones proporcionadas. Trabajas unicamente ' +
  'con el contenido de la transcripcion: no inventas datos que no aparezcan en ella.';

export const BUILTIN_TEMPLATES = {
  literal: {
    name: 'Transcripcion literal',
    description: 'El texto tal cual, sin post-proceso. Instantaneo y sin coste adicional.',
    prompt: null, // sin prompt = no se llama al LLM
  },

  'evaluacion-proyectos': {
    name: 'Evaluacion de proyectos',
    description: 'Extrae codigo de proyecto, los 3 comentarios de los evaluadores y el estado.',
    // Conservado literalmente del prompt de la version anterior (legacy/server.js:84-97).
    prompt: [
      'Este audio corresponde a la evaluación de proyectos, para cada uno de los proyectos evaluados:',
      'Extrae el código del proyecto.',
      'Extrae exactamente los comentarios de los 3 evaluadores para cada proyecto.',
      '(No es necesario identificar el nombre de cada evaluador, solo separa claramente los 3 comentarios).',
      'No incluyas información de proyectos que no fueron evaluados.',
      '',
      'El formato de respuesta debe ser el siguiente para cada proyecto:',
      'Proyecto: [código]',
      'Comentario 1: [texto literal del primer comentario]',
      'Comentario 2: [texto literal del segundo comentario]',
      'Comentario 3: [texto literal del tercer comentario]',
      'Estado del proyecto: [Aprobado / Desaprobado]',
      '',
      'Repite esta estructura para cada uno de los proyectos evaluados, manteniendo el texto',
      'exactamente como aparece en el audio, sin resumir ni modificar los comentarios.',
    ].join('\n'),
  },

  'acta-reunion': {
    name: 'Acta de reunion',
    description: 'Asistentes, temas tratados, acuerdos y tareas pendientes con responsable.',
    prompt: [
      'Redacta un acta formal de la reunión a partir de la transcripción, con esta estructura:',
      '',
      '## Asistentes',
      'Las personas que intervienen (usa los nombres si se mencionan; si no, "Hablante 1", etc.).',
      '',
      '## Temas tratados',
      'Un apartado por tema, con lo esencial de lo discutido.',
      '',
      '## Acuerdos',
      'Las decisiones tomadas, en lista.',
      '',
      '## Tareas pendientes',
      'Tabla con: tarea | responsable | plazo. Deja el campo vacío si no se menciona.',
      '',
      '## Puntos sin resolver',
      'Lo que quedó abierto o pendiente de otra reunión.',
      '',
      'No inventes acuerdos ni responsables que no aparezcan en la transcripción.',
    ].join('\n'),
  },

  resumen: {
    name: 'Resumen ejecutivo',
    description: 'Los puntos clave en media pagina.',
    prompt: [
      'Elabora un resumen ejecutivo de la transcripción:',
      '',
      '1. Un párrafo inicial con la idea principal.',
      '2. Los puntos clave en lista (máximo 8).',
      '3. Conclusiones o siguientes pasos, si los hay.',
      '',
      'Sé conciso y fiel al contenido: no añadas interpretaciones propias.',
    ].join('\n'),
  },

  'limpiar-transcripcion': {
    name: 'Transcripcion limpia',
    description: 'Elimina muletillas y repeticiones, y ordena en parrafos. Mantiene el contenido.',
    prompt: [
      'Limpia esta transcripción para que sea legible:',
      '',
      '- Elimina muletillas, titubeos y repeticiones involuntarias.',
      '- Corrige errores evidentes de puntuación y de reconocimiento.',
      '- Organiza el texto en párrafos temáticos y mantén las marcas de hablante.',
      '- NO resumas, NO parafrasees y NO omitas ninguna idea: el contenido debe quedar completo.',
    ].join('\n'),
  },

  'extraer-datos': {
    name: 'Datos mencionados',
    description: 'Fechas, cifras, nombres, lugares y organizaciones citados.',
    prompt: [
      'Extrae de la transcripción, en listas separadas y citando el momento en que aparecen:',
      '',
      '- Fechas y plazos',
      '- Cifras, importes y porcentajes',
      '- Nombres de personas',
      '- Organizaciones y empresas',
      '- Lugares',
      '',
      'Si alguna categoría no aparece en el audio, indica "No se menciona".',
    ].join('\n'),
  },
};

export function listTemplates() {
  return Object.entries(BUILTIN_TEMPLATES).map(([id, t]) => ({
    id,
    name: t.name,
    description: t.description,
    isBuiltin: true,
    requiresLlm: Boolean(t.prompt),
  }));
}
