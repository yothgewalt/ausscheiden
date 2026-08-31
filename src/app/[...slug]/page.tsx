import { redirect } from 'next/navigation';

export default function CatchAllRedirect(): never {
  redirect('/');
}
