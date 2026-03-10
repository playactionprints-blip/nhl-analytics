import os
from supabase import create_client

sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

res = sb.table('players').select('full_name,gp,toi,position,icf,ixg').not_.is_('toi','null').limit(10).execute()
for p in res.data:
    print(p)
