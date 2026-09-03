import { crearApp } from './config/app';

const PUERTO = process.env.PORT ? Number(process.env.PORT) : 3000;

crearApp().listen(PUERTO, () => {
  console.log(`Backend de app-inventario escuchando en :${PUERTO}`);
});
