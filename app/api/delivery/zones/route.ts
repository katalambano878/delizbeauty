import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

async function getAuthUser(req: NextRequest) {
    const token = req.cookies.get('sb-access-token')?.value;
    if (!token) return null;
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return null;
    const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
    if (!profile || (profile.role !== 'admin' && profile.role !== 'staff')) return null;
    return { ...user, role: profile.role };
}

// GET — List zones
export async function GET(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await supabaseAdmin
        .from('delivery_zones')
        .select('*')
        .order('name', { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ zones: data || [] });
}

// POST — Create zone
export async function POST(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { name, description, regions, base_fee, express_fee, estimated_days } = body;

    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

    const { data, error } = await supabaseAdmin.from('delivery_zones').insert({
        name,
        description: description || null,
        regions: regions || [],
        base_fee: base_fee || 0,
        express_fee: express_fee || 0,
        estimated_days: estimated_days || 'Same day delivery',
        is_active: true,
    }).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ zone: data }, { status: 201 });
}

// PATCH — Update zone
export async function PATCH(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { id, name, description, regions, base_fee, express_fee, estimated_days, is_active } = body;

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const updateData: any = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description || null;
    if (regions !== undefined) updateData.regions = regions;
    if (base_fee !== undefined) updateData.base_fee = base_fee;
    if (express_fee !== undefined) updateData.express_fee = express_fee;
    if (estimated_days !== undefined) updateData.estimated_days = estimated_days;
    if (is_active !== undefined) updateData.is_active = is_active;

    const { data, error } = await supabaseAdmin.from('delivery_zones').update(updateData).eq('id', id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ zone: data });
}

// DELETE — Delete zone
export async function DELETE(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const { data: ridersInZone } = await supabaseAdmin.from('riders').select('id').eq('zone_id', id).limit(1);
    if (ridersInZone && ridersInZone.length > 0) {
        return NextResponse.json({ error: 'Cannot delete a zone with assigned riders. Reassign or remove riders first.' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from('delivery_zones').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
}
