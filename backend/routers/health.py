from fastapi import APIRouter
from database.db import run_query

router = APIRouter()

@router.get("/")
async def health():
    try:
        rows = run_query("SELECT COUNT(*) as count FROM sales")
        return {"status": "ok", "sales_rows": rows[0]["count"]}
    except Exception as e:
        return {"status": "error", "detail": str(e)}
