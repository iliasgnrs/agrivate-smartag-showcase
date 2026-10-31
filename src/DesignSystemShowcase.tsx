import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const SWATCHES = [
  { name: 'brand', className: 'bg-brand' },
  { name: 'brand-light', className: 'bg-brand-light' },
  { name: 'accent', className: 'bg-accent' },
  { name: 'surface-sub', className: 'bg-surface-sub' },
  { name: 'surface-line', className: 'bg-surface-line' },
  { name: 'status-danger', className: 'bg-status-danger-bg' },
  { name: 'status-warning', className: 'bg-status-warning-bg' },
  { name: 'status-info', className: 'bg-status-info-bg' },
];

export default function DesignSystemShowcase() {
  return (
    <main className="min-h-screen bg-surface-app p-6 md:p-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-brand">Agrivate SmartAg — Design System</h1>
        <p className="text-muted-foreground">
          Public subset of the production UI kit: tokens, shadcn/ui primitives and agro-specific
          surfaces.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Colour tokens</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {SWATCHES.map((s) => (
              <div key={s.name} className="space-y-1">
                <div className={`h-14 rounded-md border border-surface-line ${s.className}`} />
                <p className="text-xs text-muted-foreground">{s.name}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Controls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="destructive">Destructive</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge>Live</Badge>
              <Badge variant="secondary">Season</Badge>
              <Badge variant="outline">Draft</Badge>
            </div>
            <Separator />
            <div className="grid gap-2">
              <Label htmlFor="ds-email">Field label</Label>
              <Input id="ds-email" placeholder="you@example.com" />
            </div>
            <div className="flex items-center gap-3">
              <Switch id="ds-switch" />
              <Label htmlFor="ds-switch">Notifications</Label>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Surfaces &amp; status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={62} />
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="alert-danger rounded-xl p-3 text-sm">Critical heat stress</div>
              <div className="alert-warning rounded-xl p-3 text-sm">Disease risk elevated</div>
              <div className="alert-info rounded-xl p-3 text-sm">Soil moisture alert</div>
            </div>
            <Tabs defaultValue="forecast">
              <TabsList>
                <TabsTrigger value="forecast">Forecast</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>
              <TabsContent value="forecast" className="text-sm text-muted-foreground">
                Forecast panel slot.
              </TabsContent>
              <TabsContent value="history" className="text-sm text-muted-foreground">
                History panel slot.
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
