// ChatKit con un workflow alojado en Agent Builder (Agent Builder cierra el 30/11/2026; ChatKit sigue).
import OpenAI from 'openai';

const openai = new OpenAI();

export async function sesion(userId) {
  const session = await openai.beta.chatkit.sessions.create({
    workflow: { id: 'wf_68df4b13b3588190a09d19288d4610ec0df388c3983f58d1' },
    user: userId,
  });
  return session.client_secret;
}
