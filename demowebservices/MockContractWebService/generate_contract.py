from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet

# Create PDF
doc = SimpleDocTemplate("Mock_Cloud_Contract.pdf", pagesize=A4)
styles = getSampleStyleSheet()
elements = []

# Title
elements.append(Paragraph("Cloud Service Agreement", styles['Title']))
elements.append(Spacer(1, 20))

# Parties
elements.append(Paragraph("<b>Between:</b>", styles['Normal']))
elements.append(Paragraph("Bank Name: Alpine Bank AG", styles['Normal']))
elements.append(Paragraph("Cloud Service Provider: SkyCloud Solutions GmbH", styles['Normal']))
elements.append(Spacer(1, 20))

# Table Data
data = [
    ["CMT Field Name", "Value"],
    ["Term Type", "Fixed Term – 36 Months"],
    ["Effective Date", "01 January 2026"],
    ["Outsourcing", "Yes"],
    ["Total Contract Value (TCV)", "€2,500,000"],
    ["Penalties Agreed", "Yes"],
    ["Penalty Rules – Where To Find In Contract?", "Section 12.3 – Service Level Breach"],
    ["Cloud", "Public Cloud – Multi-Region Deployment"],
    ["GDPR", "Yes"],
    ["GDPR 28 Data Processor / Data Controller", "Data Processor"]
]

table = Table(data, colWidths=[200, 250])
table.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), colors.grey),
    ('TEXTCOLOR', (0,0), (-1,0), colors.whitesmoke),
    ('ALIGN', (0,0), (-1,-1), 'LEFT'),
    ('GRID', (0,0), (-1,-1), 1, colors.black),
    ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
]))
elements.append(table)
elements.append(Spacer(1, 20))

# Additional Clauses
elements.append(Paragraph("<b>Penalty Rules:</b>", styles['Heading2']))
elements.append(Paragraph("• SLA breach: €10,000 per incident<br/>• Data breach: €50,000 per incident", styles['Normal']))
elements.append(Spacer(1, 10))
elements.append(Paragraph("<b>Compliance:</b>", styles['Heading2']))
elements.append(Paragraph("• Provider must maintain ISO 27001 certification<br/>• GDPR compliance audits annually", styles['Normal']))
elements.append(Spacer(1, 40))

# Signatures
elements.append(Paragraph("___________________________        ___________________________", styles['Normal']))
elements.append(Paragraph("Bank Representative                      Cloud Provider Representative", styles['Normal']))

# Build PDF
doc.build(elements)
print("PDF generated successfully: Mock_Cloud_Contract.pdf")
