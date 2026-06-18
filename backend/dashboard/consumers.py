import json
from channels.generic.websocket import AsyncWebsocketConsumer

GROUP = 'dashboard'


class DashboardConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        if not self.scope['user'].is_authenticated:
            await self.close()
            return
        await self.channel_layer.group_add(GROUP, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        await self.channel_layer.group_discard(GROUP, self.channel_name)

    # Mensagem enviada pelo group_send com type='dashboard.refresh'
    async def dashboard_refresh(self, event):
        await self.send(text_data=json.dumps({
            'type': 'refresh',
            'scope': event.get('scope', 'all'),
        }))
