use clap::{Parser, Subcommand};
use mpp::protocol::core::headers::{parse_receipt, parse_www_authenticate};
use mpp::protocol::intents::ChargeRequest;

#[derive(Parser)]
#[command(name = "mpp-verify")]
#[command(about = "Parse and verify Tempo MPP payment challenges and receipts")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Parse a WWW-Authenticate challenge header
    Challenge {
        /// The WWW-Authenticate header value (the part after "Payment ")
        header: String,

        /// Optional secret key to verify the challenge ID binding
        #[arg(long)]
        secret_key: Option<String>,
    },
    /// Parse a Payment-Receipt header
    Receipt {
        /// The Payment-Receipt header value
        header: String,
    },
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Challenge { header, secret_key } => {
            // Ensure header starts with "Payment "
            let full_header = if header.starts_with("Payment ") {
                header.clone()
            } else {
                format!("Payment {}", header)
            };

            match parse_www_authenticate(&full_header) {
                Ok(challenge) => {
                    println!("Challenge parsed successfully:");
                    println!("  ID:          {}", challenge.id);
                    println!("  Realm:       {}", challenge.realm);
                    println!("  Method:      {}", challenge.method);
                    println!("  Intent:      {}", challenge.intent);

                    if let Some(desc) = &challenge.description {
                        println!("  Description: {}", desc);
                    }
                    if let Some(exp) = &challenge.expires {
                        println!("  Expires:     {}", exp);
                    }

                    // Try to decode request as ChargeRequest
                    match challenge.request.decode::<ChargeRequest>() {
                        Ok(req) => {
                            println!("\n  Charge Request:");
                            println!("    Amount:    {} (base units)", req.amount);
                            println!("    Currency:  {}", req.currency);
                            if let Some(r) = &req.recipient {
                                println!("    Recipient: {}", r);
                            }
                            if let Some(d) = &req.description {
                                println!("    Desc:      {}", d);
                            }
                        }
                        Err(_) => {
                            // Not a charge request, show raw
                            if let Ok(val) = challenge.request.decode_value() {
                                println!("\n  Request: {}", serde_json::to_string_pretty(&val).unwrap_or_default());
                            }
                        }
                    }

                    // Verify challenge ID if secret key provided
                    if let Some(key) = secret_key {
                        let valid = challenge.verify(&key);
                        println!("\n  Challenge ID valid: {}", valid);
                    }

                    // Check expiration
                    if challenge.is_expired() {
                        println!("\n  WARNING: Challenge has expired!");
                    }
                }
                Err(e) => {
                    eprintln!("Failed to parse challenge: {}", e);
                    std::process::exit(1);
                }
            }
        }
        Commands::Receipt { header } => {
            match parse_receipt(&header) {
                Ok(receipt) => {
                    println!("Receipt parsed successfully:");
                    println!("  Status:    {}", receipt.status);
                    println!("  Method:    {}", receipt.method);
                    println!("  Reference: {}", receipt.reference);
                    println!("  Timestamp: {}", receipt.timestamp);
                }
                Err(e) => {
                    eprintln!("Failed to parse receipt: {}", e);
                    std::process::exit(1);
                }
            }
        }
    }
}
