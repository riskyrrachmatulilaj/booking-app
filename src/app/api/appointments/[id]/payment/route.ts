import { handlePayment } from '@/server/payments';
type Context = { params: Promise<{ id: string }> };
export const POST = async (request: Request, context: Context) => handlePayment(request, (await context.params).id);
